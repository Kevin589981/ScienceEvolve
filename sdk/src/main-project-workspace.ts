import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

interface WorkspaceBinding { path: string; dev: string; ino: string }
const projectIdPattern = /^prj_[a-f0-9]{32}$/;
function contains(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** SDK-owned deployment bindings; never accepted from workflow or Agent input. */
export class MainProjectWorkspaceStore {
  private readonly file: string;
  private bindings: Record<string, WorkspaceBinding> = Object.create(null);
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, "workspace-bindings.json");
  }

  async initialize(): Promise<void> {
    let value: unknown;
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid workspace binding registry");
      value = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Existing main data without external bindings remains valid. Once a
        // workspace is selected, the private registry is created atomically.
        await this.verifyProjectMarkers();
        return;
      }
      throw error;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace binding registry");
    const registry = value as Record<string, unknown>;
    if (registry.schemaVersion !== 1 || Object.keys(registry).some((key) => !["schemaVersion", "projects"].includes(key)) ||
      !registry.projects || typeof registry.projects !== "object" || Array.isArray(registry.projects)) {
      throw new Error("Invalid workspace binding registry");
    }
    for (const [id, raw] of Object.entries(registry.projects)) {
      if (!projectIdPattern.test(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid workspace binding");
      const binding = raw as WorkspaceBinding;
      if (Object.keys(binding).some((key) => !["path", "dev", "ino"].includes(key)) ||
        typeof binding.path !== "string" || !path.isAbsolute(binding.path) ||
        typeof binding.dev !== "string" || !/^\d+$/.test(binding.dev) ||
        typeof binding.ino !== "string" || !/^\d+$/.test(binding.ino)) throw new Error("Invalid workspace binding");
      await this.verify(binding);
      this.bindings[id] = { ...binding };
    }
    // A missing registry must not silently move a previously bound project
    // back into a newly created internal workspace after restart.
    await this.verifyProjectMarkers();
  }

  private async directory(directory: string): Promise<WorkspaceBinding> {
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("workspace must be an existing real directory, not a symlink/junction");
    const canonical = await fs.realpath(directory);
    const realData = await fs.realpath(this.dataDir);
    if (contains(realData, canonical) || contains(canonical, realData)) {
      throw new Error("workspace and dataDir must not contain one another");
    }
    return { path: canonical, dev: stat.dev.toString(), ino: stat.ino.toString() };
  }

  async prepare(directory: string, reconfiguration = false): Promise<WorkspaceBinding> {
    if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("API workspace must be an absolute path");
    const binding = await this.directory(path.resolve(directory));
    try {
      const memory = await fs.lstat(path.join(binding.path, "Memory.md"));
      if (!memory.isFile() || memory.isSymbolicLink()) throw new Error("Existing workspace Memory.md must be a regular non-symlink file");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return binding;
  }

  private async verify(binding: WorkspaceBinding): Promise<void> {
    const observed = await this.directory(binding.path);
    if (observed.path !== binding.path || observed.dev !== binding.dev || observed.ino !== binding.ino) {
      throw new Error("Selected workspace directory changed; refusing to use another directory");
    }
  }

  private marker(id: string): string {
    if (!projectIdPattern.test(id)) throw new Error("Invalid workspace project ID");
    return path.join(this.dataDir, "projects", id, ".sdk-workspace.json");
  }

  private async verifyProjectMarkers(): Promise<void> {
    const projects = path.join(this.dataDir, "projects");
    let entries;
    try { entries = await fs.readdir(projects, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (!projectIdPattern.test(entry.name) || !entry.isDirectory()) continue;
      let marker;
      try { marker = JSON.parse(await fs.readFile(this.marker(entry.name), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      const binding = this.bindings[entry.name];
      if (!binding || JSON.stringify(marker) !== JSON.stringify(binding)) throw new Error("Selected workspace binding is missing or inconsistent");
    }
  }

  async bind(id: string, binding: WorkspaceBinding | null): Promise<void> {
    if (!binding) return;
    this.marker(id);
    await this.verify(binding);
    const operation = this.tail.then(async () => {
      const existing = this.bindings[id];
      if (existing && JSON.stringify(existing) !== JSON.stringify(binding)) throw new Error("Cannot replace a saved workspace binding");
      const updated = { ...this.bindings, [id]: { ...binding } };
      await this.saveBindings(updated);
      await fs.mkdir(path.dirname(this.marker(id)), { recursive: true, mode: 0o700 });
      await fs.writeFile(this.marker(id), JSON.stringify(binding) + "\n", { flag: "wx", mode: 0o600 });
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async saveBindings(updated: Record<string, WorkspaceBinding>): Promise<void> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, projects: updated }) + "\n", { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, this.file);
      this.bindings = updated;
    } finally {
      await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }

  /** Roll back only this host's private binding when project creation never persisted state. */
  async releaseUnpersisted(id: string): Promise<void> {
    const marker = this.marker(id);
    const operation = this.tail.then(async () => {
      try {
        await fs.lstat(path.join(path.dirname(marker), "state.json"));
        return; // Any state entry, including a symlink, must be retained conservatively.
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!this.bindings[id]) return;
      await fs.unlink(marker).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      const updated = { ...this.bindings };
      delete updated[id];
      await this.saveBindings(updated);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  path(id: string): string | undefined { return this.bindings[id]?.path; }

  async resolve(id: string): Promise<string | undefined> {
    // Harness smoke probes use synthetic probe-* IDs with an owned workspace;
    // only persisted prj_* projects can have an external host binding.
    if (!projectIdPattern.test(id)) return undefined;
    const binding = this.bindings[id];
    if (!binding) return undefined;
    await this.verify(binding);
    return binding.path;
  }
}
