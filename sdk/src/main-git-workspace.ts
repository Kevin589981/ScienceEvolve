import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exportMainWorkspace, mainGitEnvironment, MAIN_WORKSPACE_LIMITS, parseMainWorkspaceTree } from "./main-workspace.js";
import { assertMainSourceFile, readMainWorkspaceFile, type MainSourceEntry, type MainSourceWorkspaceStore } from "./main-source-workspace.js";
import type { ProjectView } from "./core/types.js";

type Fingerprint = Pick<MainSourceEntry, "sha256" | "size" | "mode">;
type Files = Record<string, Fingerprint>;
// A filename may also be an Object prototype name. Registry JSON and
// structuredClone restore ordinary objects; absent entries must stay absent.
function fingerprint(files: Files, name: string): Fingerprint | null {
  return Object.hasOwn(files, name) ? files[name] : null;
}
export interface MainWorkspaceDelivery {
  status: "pending" | "applying" | "synced" | "conflict" | "failed";
  destination: string;
  commit?: string;
  files?: number;
  conflicts?: string[];
  message?: string;
  generation?: number;
}
interface Change { name: string; before: Fingerprint | null; after: Fingerprint | null }
interface Binding {
  path: string; dev: string; ino: string; baseline: Files;
  delivery: MainWorkspaceDelivery;
  journal?: { stage: string; commit: string; changes: Change[]; next: Files };
}
const idPattern = /^prj_[a-f0-9]{32}$/;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
function equal(a: Fingerprint | null | undefined, b: Fingerprint | null | undefined) {
  return (!a && !b) || !!(a && b && a.sha256 === b.sha256 && a.size === b.size &&
    (process.platform === "win32" || a.mode === b.mode));
}
function allowed(name: string) {
  try { assertMainSourceFile(name); return true; } catch { return false; }
}
function validateFiles(files: Files) {
  if (!files || typeof files !== "object" || Array.isArray(files) || Object.keys(files).length > MAIN_WORKSPACE_LIMITS.files) throw new Error("Invalid workspace delivery manifest");
  for (const [name, entry] of Object.entries(files)) {
    assertMainSourceFile(name);
    if (name.split("/").some(part => !part || part === "." || part === "..") || path.isAbsolute(name) || /[\\\x00-\x1f:*?"<>|]/.test(name) ||
      !entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      entry.size > MAIN_WORKSPACE_LIMITS.fileBytes || !["100644", "100755"].includes(entry.mode)) throw new Error("Invalid workspace delivery entry");
  }
  parseMainWorkspaceTree(Buffer.from(Object.entries(files).map(([name, entry]) => `${entry.mode} blob ${"0".repeat(40)} ${entry.size}\t${name}\0`).join("")));
}
async function regularJson(file: string) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("Workspace registry must be a private regular file");
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function pinDirectory(directory: string) {
  const info = await fs.lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("workspace must be an existing real directory");
  return { path: await fs.realpath(directory), dev: info.dev.toString(), ino: info.ino.toString() };
}
async function namesIn(directory: string): Promise<string[]> {
  const names: string[] = [];
  let isGit = false;
  try { await fs.lstat(path.join(directory, ".git")); isGit = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (isGit) {
    const git = (args: string[]) => new Promise<string>((resolve, reject) => {
      execFile("git", ["--no-replace-objects", "-c", `safe.directory=${directory}`, "-c", "core.hooksPath=/dev/null", "-C", directory, ...args],
        { env: mainGitEnvironment(), encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: MAIN_WORKSPACE_LIMITS.treeBytes },
        (error, stdout) => error ? reject(new Error("Cannot inspect workspace Git index safely")) : resolve(stdout));
    });
    if (await fs.realpath((await git(["rev-parse", "--show-toplevel"])).trim()) !== directory) throw new Error("Git workspace must be the repository root");
    const candidates = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
    for (const name of new Set(candidates)) {
      if (!allowed(name)) continue;
      try { await fs.lstat(path.join(directory, name)); names.push(name); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } // A caller's existing deletion remains deleted.
    }
  } else {
    let directories = 0;
    const walk = async (prefix: string) => {
      if (++directories > MAIN_WORKSPACE_LIMITS.files || prefix.split("/").length > 128) throw new Error("Workspace directory traversal limit exceeded");
      for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!allowed(name)) continue;
        if (entry.isSymbolicLink()) throw new Error(`Workspace import refuses symbolic links: ${name}`);
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile()) names.push(name);
        else throw new Error(`Workspace import requires ordinary files: ${name}`);
        if (names.length > MAIN_WORKSPACE_LIMITS.files) throw new Error("Workspace exceeds 5000 importable files");
      }
    };
    await walk("");
  }
  return names.sort();
}

/** SDK host delivery only: the main kernel's execution/worktree/Git policy stays unchanged. */
export class MainGitWorkspaceStore {
  private readonly file: string;
  private bindings: Record<string, Binding> = Object.create(null);
  private writes: Promise<void> = Promise.resolve();
  private readonly operations = new Map<string, Promise<MainWorkspaceDelivery | undefined>>();
  constructor(private readonly dataDir: string, private readonly sources: MainSourceWorkspaceStore) {
    this.file = path.join(dataDir, "git-workspace-bindings.json");
  }
  async initialize() {
    let registry;
    try {
      registry = await regularJson(this.file);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (registry !== undefined) {
      if (registry.schemaVersion !== 1 || !registry.projects || Array.isArray(registry.projects)) throw new Error("Invalid Git workspace registry");
      for (const [id, value] of Object.entries(registry.projects)) {
        if (!idPattern.test(id)) throw new Error("Invalid Git workspace project ID");
        const binding = value as Binding;
        if (!binding || !path.isAbsolute(binding.path) || !/^\d+$/.test(binding.dev) || !/^\d+$/.test(binding.ino)) throw new Error("Invalid Git workspace identity");
        validateFiles(binding.baseline);
        if (binding.journal) {
          validateFiles(binding.journal.next);
          if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(binding.journal.commit) || !Array.isArray(binding.journal.changes)) throw new Error("Invalid delivery journal");
          for (const change of binding.journal.changes) {
            if (!change.before && !change.after) throw new Error("Invalid empty delivery change");
            if (change.before) validateFiles({ [change.name]: change.before });
            if (change.after) validateFiles({ [change.name]: change.after });
            if (!equal(change.before, fingerprint(binding.baseline, change.name)) || !equal(change.after, fingerprint(binding.journal.next, change.name))) throw new Error("Delivery journal disagrees with its manifests");
          }
          const expected = [...new Set([...Object.keys(binding.baseline), ...Object.keys(binding.journal.next)])].filter(name => !equal(fingerprint(binding.baseline, name), fingerprint(binding.journal!.next, name))).sort();
          if (JSON.stringify(expected) !== JSON.stringify(binding.journal.changes.map(change => change.name))) throw new Error("Incomplete delivery journal");
        }
        if (!binding.delivery || !["pending", "applying", "synced", "conflict", "failed"].includes(binding.delivery.status) ||
          binding.delivery.destination !== binding.path ||
          (binding.delivery.generation !== undefined && (!Number.isSafeInteger(binding.delivery.generation) || binding.delivery.generation < 0)) ||
          (binding.delivery.status === "synced" && (binding.journal || binding.delivery.generation === undefined || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(binding.delivery.commit ?? "")))) throw new Error("Invalid workspace delivery state");
        await this.verify(binding);
        this.bindings[id] = binding;
      }
    }
    const projectRoot = path.join(this.dataDir, "projects");
    const projects = await fs.readdir(projectRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    for (const entry of projects) {
      if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
      try {
        const marker = await regularJson(path.join(projectRoot, entry.name, ".sdk-git-workspace.json"));
        const binding = this.bindings[entry.name];
        if (!binding || marker.path !== binding.path || marker.dev !== binding.dev || marker.ino !== binding.ino) throw new Error("Git workspace binding lost; refusing silent delivery fallback");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (this.bindings[entry.name]) throw new Error("Git workspace marker lost; refusing silent delivery fallback");
      }
    }
  }
  private async verify(binding: Pick<Binding, "path" | "dev" | "ino">) {
    const current = await pinDirectory(binding.path), data = await fs.realpath(this.dataDir);
    if (current.path !== binding.path || current.dev !== binding.dev || current.ino !== binding.ino || inside(data, current.path) || inside(current.path, data)) throw new Error("Original workspace changed or overlaps runtime data");
  }
  async prepare(directory: string) {
    if (!path.isAbsolute(directory)) throw new Error("API workspace must be absolute");
    const identity = await pinDirectory(path.resolve(directory));
    await this.verify(identity);
    const names = await namesIn(identity.path);
    const source = names.length ? await this.sources.prepare({ path: identity.path, files: names }) : null;
    const entries = source ? await this.sources.snapshotEntries(source) : [];
    const baseline: Files = Object.fromEntries(entries.map(({ path: name, ...entry }) => [name, entry]));
    return { source, binding: { ...identity, baseline, delivery: { status: "pending", destination: identity.path } } as Binding };
  }
  private save() {
    const operation = this.writes.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, projects: this.bindings }) + "\n", { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.file);
      } finally { await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
    });
    this.writes = operation.catch(() => {}); return operation;
  }
  async bind(id: string, binding: Binding) {
    if (!idPattern.test(id) || this.bindings[id]) throw new Error("Invalid or already bound Git workspace");
    await this.verify(binding);
    this.bindings[id] = structuredClone(binding); await this.save();
    const project = path.join(this.dataDir, "projects", id);
    await fs.mkdir(project, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(project, ".sdk-git-workspace.json"), JSON.stringify({ path: binding.path, dev: binding.dev, ino: binding.ino }), { flag: "wx", mode: 0o600 });
  }
  async releaseUnpersisted(id: string) {
    if (!idPattern.test(id) || !this.bindings[id]) return;
    const project = path.join(this.dataDir, "projects", id);
    try { await fs.lstat(path.join(project, "state.json")); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.unlink(path.join(project, ".sdk-git-workspace.json")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    delete this.bindings[id]; await this.save();
  }
  receipt(id: string) { return this.bindings[id] ? structuredClone(this.bindings[id].delivery) : undefined; }
  ids() { return Object.keys(this.bindings); }
  async flush() { await Promise.all([...this.operations.values()]); await this.writes; }
  synchronize(state: ProjectView, retry = false): Promise<MainWorkspaceDelivery | undefined> {
    const active = this.operations.get(state.id); if (active) return active;
    const operation = this.apply(state, retry);
    this.operations.set(state.id, operation);
    void operation.finally(() => { if (this.operations.get(state.id) === operation) this.operations.delete(state.id); }).catch(() => {});
    return operation;
  }
  private async current(root: string, name: string): Promise<Fingerprint | null> {
    try { const { bytes, executable } = await readMainWorkspaceFile(root, name); return { sha256: hash(bytes), size: bytes.length, mode: executable ? "100755" : "100644" }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  private async apply(state: ProjectView, retry: boolean) {
    const binding = this.bindings[state.id];
    if (!binding) return undefined;
    if (state.status !== "completed") {
      // Reopened completion generations need a new trailing reconciliation;
      // already delivered, inactive projects need no forever-polling sweep.
      if (binding.delivery.status === "synced") {
        binding.delivery = { status: "pending", destination: binding.path };
        await this.save();
      }
      return this.receipt(state.id);
    }
    if (!state.git?.enabled || state.git.status !== "ready" || !state.git.repository?.localPath) throw new Error("Workspace delivery requires the completed integrated Git repository");
    if (!retry && ["conflict", "failed"].includes(binding.delivery.status)) return this.receipt(state.id);
    if (binding.delivery.status === "synced" && binding.delivery.generation === (state.completionGeneration ?? 0)) return this.receipt(state.id);
    const repository = state.git.repository.localPath;
    let lock: Awaited<ReturnType<typeof fs.open>> | undefined;
    const lockPath = path.join(binding.path, ".scienceevolve-sdk-delivery.lock");
    try {
      await this.verify(binding);
      lock = await fs.open(lockPath, "wx", 0o600);
      await lock.writeFile(JSON.stringify({ projectId: state.id, dataDir: this.dataDir }));
      if (!binding.journal) {
        const staging = path.join(this.dataDir, "projects", state.id, "workspace-deliveries");
        await fs.mkdir(staging, { recursive: true, mode: 0o700 });
        const stage = path.join(staging, randomUUID());
        const exported = await exportMainWorkspace({ dataDir: this.dataDir, projectDir: path.join(this.dataDir, "projects", state.id), repository, options: { destination: stage }, ownedStaging: true });
        const next: Files = Object.create(null);
        for (const name of await namesIn(stage)) {
          const entry = await this.current(stage, name); if (entry) next[name] = entry;
        }
        validateFiles(next);
        const changes: Change[] = [...new Set([...Object.keys(binding.baseline), ...Object.keys(next)])].sort().flatMap(name => {
          const before = fingerprint(binding.baseline, name), after = fingerprint(next, name);
          return equal(before, after) ? [] : [{ name, before, after }];
        });
        binding.journal = { stage, commit: exported.commit, changes, next };
      }
      const journal = binding.journal;
      const expectedRoot = path.join(this.dataDir, "projects", state.id, "workspace-deliveries");
      const privateRoot = await fs.realpath(expectedRoot);
      if (privateRoot !== expectedRoot) throw new Error("Delivery private root changed");
      if (!inside(privateRoot, journal.stage) || (await pinDirectory(journal.stage)).path !== journal.stage) throw new Error("Delivery staging path changed");
      const conflicts: string[] = [];
      for (const change of journal.changes) {
        try {
          const current = await this.current(binding.path, change.name);
          if (!equal(current, change.before) && !equal(current, change.after)) conflicts.push(change.name);
        } catch { conflicts.push(change.name); }
      }
      if (conflicts.length) {
        binding.delivery = { status: "conflict", destination: binding.path, commit: journal.commit, conflicts,
          message: "Original workspace changed during execution; no conflicting file was overwritten. Restore/resolve these files and explicitly retry workspace delivery, or export the result separately." };
        await this.save(); return this.receipt(state.id);
      }
      binding.delivery = { status: "applying", destination: binding.path, commit: journal.commit };
      await this.save(); // Durable plan before the first write; restart can finish exact after/before images.
      const backupRoot = path.join(privateRoot, `backup-${journal.commit}`);
      await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
      for (const change of journal.changes) {
        await this.verify(binding);
        const current = await this.current(binding.path, change.name);
        if (equal(current, change.after)) continue;
        if (!equal(current, change.before)) throw new Error(`Workspace changed during delivery: ${change.name}`);
        if (current) {
          const { bytes } = await readMainWorkspaceFile(binding.path, change.name);
          await fs.writeFile(path.join(backupRoot, current.sha256), bytes, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
        }
        const target = path.join(binding.path, ...change.name.split("/"));
        if (!inside(binding.path, target)) throw new Error("Unsafe delivery target");
        if (!change.after) await fs.unlink(target);
        else {
          let parent = binding.path;
          for (const segment of change.name.split("/").slice(0, -1)) {
            parent = path.join(parent, segment);
            await fs.mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
            if ((await pinDirectory(parent)).path !== parent) throw new Error("Delivery parent escaped the workspace");
          }
          const { bytes } = await readMainWorkspaceFile(journal.stage, change.name);
          if (hash(bytes) !== change.after.sha256) throw new Error("Staged delivery bytes changed");
          const temporary = path.join(parent, `.scienceevolve-delivery-${randomUUID()}.tmp`);
          try {
            await fs.writeFile(temporary, bytes, { flag: "wx", mode: change.after.mode === "100755" ? 0o755 : 0o644 });
            if (!equal(await this.current(binding.path, change.name), change.before)) throw new Error("Workspace changed before atomic delivery");
            await fs.rename(temporary, target);
          } finally { await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
        }
      }
      binding.baseline = journal.next;
      binding.delivery = { status: "synced", destination: binding.path, commit: journal.commit, files: journal.changes.length, generation: state.completionGeneration ?? 0 };
      delete binding.journal; await this.save();
      return this.receipt(state.id);
    } catch (error) {
      binding.delivery = { status: "failed", destination: binding.path, ...(binding.journal ? { commit: binding.journal.commit } : {}),
        message: error instanceof Error ? error.message : "Workspace delivery failed" };
      await this.save(); return this.receipt(state.id);
    } finally {
      if (lock) {
        await lock.close();
        await fs.unlink(lockPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      }
    }
  }
}
