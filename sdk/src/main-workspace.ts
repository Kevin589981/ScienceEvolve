import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

export interface MainWorkspaceExportOptions {
  /** Absolute, not-yet-existing directory with an existing parent, outside runtime data. */
  destination: string;
  /** Cancels only this export; it does not cancel the research run. */
  signal?: AbortSignal;
}
export interface MainWorkspaceExportResult {
  destination: string;
  commit: string;
  files: number;
  bytes: number;
}
// Bounded, portable snapshot export, not a checkout/import or an implicit delivery merge.
export const MAIN_WORKSPACE_LIMITS = { files: 5_000, fileBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, treeBytes: 8 * 1024 * 1024 };
const limits = MAIN_WORKSPACE_LIMITS;
const shaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function inside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
async function plainDirectory(directory: string) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Workspace export requires real directories, not symlinks/junctions");
  return fs.realpath(directory);
}

/** Read objects without filters, hooks, credentials, ambient Git config or a network fetch. */
export function mainGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", LC_ALL: "C" };
  for (const key of ["PATH", "SYSTEMROOT", "WINDIR"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}
export function mainWorkspaceGitObjects(repository: string, args: string[], maxBuffer: number, signal?: AbortSignal, stdin?: Buffer): Promise<Buffer> {
  signal?.throwIfAborted();
  const env = mainGitEnvironment();
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["--no-replace-objects", "-c", `safe.directory=${repository}`,
      "-c", "core.hooksPath=/dev/null", "--git-dir", repository, ...args],
    { encoding: "buffer", env, windowsHide: true, timeout: 30_000, maxBuffer, signal }, (error, stdout) => {
      // Do not forward raw execFile errors (which can contain blob contents or config secrets).
      if (error) reject(new Error(signal?.aborted ? "Workspace operation cancelled" : `Workspace Git object operation failed (${args[0]})`));
      else resolve(stdout);
    });
    child.stdin?.on("error", () => { /* Completion callback reports spawn/write failure without blob contents. */ });
    child.stdin?.end(stdin);
  });
}
const gitObjects = mainWorkspaceGitObjects;

interface BlobEntry { name: string; oid: string; size: number; executable: boolean }
export function parseMainWorkspaceTree(tree: Buffer): BlobEntry[] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: BlobEntry[] = [];
  const paths = new Set<string>();
  const directories = new Set<string>();
  const directoryNames = new Map<string, string>();
  let offset = 0, total = 0;
  while (offset < tree.length) {
    const end = tree.indexOf(0, offset);
    if (end < 0) throw new Error("Invalid Git tree framing");
    const record = decoder.decode(tree.subarray(offset, end)); offset = end + 1;
    const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64}) +(\d+)\t(.+)$/.exec(record);
    if (!match) throw new Error("Workspace export supports regular files only; symlinks and submodules require an explicit delivery strategy");
    const mode = match[1]!, oid = match[2]!, sizeText = match[3]!, name = match[4]!;
    const parts = name.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || /^\.git$/i.test(part) ||
      /[\\\x00-\x1f\x7f:*?"<>|]/.test(part) || /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error("Git tree contains a non-portable or unsafe workspace path");
    }
    const key = name.normalize("NFC").toLowerCase();
    const parents = parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/").normalize("NFC").toLowerCase());
    if (paths.has(key) || directories.has(key) || parents.some((parent) => paths.has(parent))) {
      throw new Error("Git tree contains a case/normalization or file/directory collision");
    }
    // Directory aliases (Foo/a vs foo/b) would merge on Windows/macOS: reject, never silently combine.
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join("/");
      const normalized = parent.normalize("NFC").toLowerCase();
      const previous = directoryNames.get(normalized);
      if (previous !== undefined && previous !== parent) throw new Error("Git tree contains a case/normalization directory collision");
      directoryNames.set(normalized, parent); directories.add(normalized);
    }
    paths.add(key);
    const size = Number(sizeText); total += size;
    if (!Number.isSafeInteger(size) || size > limits.fileBytes || total > limits.totalBytes || entries.length >= limits.files) {
      throw new Error("Workspace export exceeds limits: 5000 files, 32 MiB/file, 256 MiB total");
    }
    entries.push({ name, oid, size, executable: mode === "100755" });
  }
  return entries;
}
const parseTree = parseMainWorkspaceTree;

/** Internal host adapter: public callers use RunHandle.exportWorkspace, never an arbitrary repository. */
export async function exportMainWorkspace(input: {
  dataDir: string; projectDir: string; repository: string; options: MainWorkspaceExportOptions;
  /** Trusted host-only staging; never accepted from exportWorkspace options. */
  ownedStaging?: true;
}): Promise<MainWorkspaceExportResult> {
  const { options } = input;
  if (!options || typeof options.destination !== "string" || !path.isAbsolute(options.destination)) throw new Error("Workspace export destination must be absolute");
  if (Object.keys(options).some((key) => !["destination", "signal"].includes(key))) throw new Error("Unknown workspace export option");
  options.signal?.throwIfAborted();
  const dataDir = await plainDirectory(input.dataDir);
  const projectDir = await plainDirectory(input.projectDir);
  if (!inside(dataDir, projectDir) || projectDir === dataDir) throw new Error("Project directory is outside this runtime");
  const expectedRepository = path.join(projectDir, "repository");
  if (path.resolve(input.repository) !== expectedRepository) throw new Error("Repository is not the runtime-owned project repository");
  const repository = await plainDirectory(expectedRepository);
  if (!inside(projectDir, repository)) throw new Error("Repository is outside this project");
  const destinationPath = path.resolve(options.destination);
  const parent = await fs.realpath(path.dirname(destinationPath));
  const destination = path.join(parent, path.basename(destinationPath));
  const ownedParent = path.join(projectDir, "workspace-deliveries");
  const ownedStaging = input.ownedStaging === true && parent === ownedParent &&
    await plainDirectory(ownedParent) === ownedParent;
  if (destination === parent || (inside(dataDir, destination) && !ownedStaging) || inside(destination, dataDir)) throw new Error("Workspace export must be outside runtime data");
  if ((await gitObjects(repository, ["rev-parse", "--is-bare-repository"], 1024, options.signal)).toString("utf8").trim() !== "true") {
    throw new Error("Workspace export requires the runtime-owned bare repository");
  }
  const commit = (await gitObjects(repository, ["rev-parse", "--verify", "refs/heads/main^{commit}"], 1024, options.signal)).toString("utf8").trim();
  if (!shaPattern.test(commit)) throw new Error("Invalid integrated main commit");
  const tree = parseTree(await gitObjects(repository, ["ls-tree", "-rz", "--long", "--full-tree", commit], limits.treeBytes, options.signal));
  options.signal?.throwIfAborted();
  // Exclusive creation: never overwrite even an empty destination; fail without recursive cleanup.
  await fs.mkdir(destination, { mode: 0o700 });
  let bytes = 0;
  try {
    for (const entry of tree) {
      options.signal?.throwIfAborted();
      const blob = await gitObjects(repository, ["cat-file", "blob", entry.oid], entry.size + 1024, options.signal);
      if (blob.length !== entry.size) throw new Error("Git blob size differs from the pinned tree");
      const segments = entry.name.split("/");
      let directory = destination;
      for (const segment of segments.slice(0, -1)) {
        directory = path.join(directory, segment);
        try { await fs.mkdir(directory, { mode: 0o700 }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        if (await plainDirectory(directory) !== directory) throw new Error("Workspace export directory changed during writing");
      }
      if (await plainDirectory(destination) !== destination) throw new Error("Workspace export destination changed during writing");
      const file = await fs.open(path.join(directory, segments.at(-1)!), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), entry.executable ? 0o700 : 0o600);
      try { await file.writeFile(blob); if (process.platform !== "win32") await file.chmod(entry.executable ? 0o700 : 0o600); }
      finally { await file.close(); }
      bytes += blob.length;
    }
    return { destination, commit, files: tree.length, bytes };
  } catch (error) {
    throw new Error(`Workspace export did not complete; partial directory retained at ${destination}: ${error instanceof Error ? error.message : "export failed"}`);
  }
}
