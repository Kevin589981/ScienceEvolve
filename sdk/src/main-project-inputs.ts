import { constants, promises as fs, type BigIntStats as Stats } from "node:fs";
import path from "node:path";

export type MainProjectInput = string | { path: string; name?: string };
export interface PreparedMainProjectInputs {
  readonly files: readonly string[];
  install(destination: string): Promise<void>;
  /** Undo a successful install before project persistence; preserve copies changed since installation. */
  rollback(): Promise<void>;
}

const MAX_FILE = 50 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_FILES = 1000;
// Empty directories also consume traversal work; bound them independently.
const MAX_ENTRIES = 10_000;
type Pin = { location: string; stat: Stats };
type InputFile = Pin & { name: string; parents: Pin[] };
type InstalledFile = Pin & { parents: Pin[] };

function safeName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024 || value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === ".." || part.length > 255 ||
      /[<>:"|?*\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part) ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part))) {
    throw new Error("Invalid project input relative path");
  }
  return value;
}
function sameIdentity(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}
function sameFile(a: Stats, b: Stats): boolean {
  return b.isFile() && !b.isSymbolicLink() && b.nlink === 1n && sameIdentity(a, b) &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
async function pinDirectory(location: string): Promise<Pin> {
  const stat = await fs.lstat(location, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project input paths must use ordinary directories");
  return { location, stat };
}
async function ancestors(location: string): Promise<Pin[]> {
  const result: Pin[] = [];
  let current = path.resolve(location);
  while (true) {
    result.unshift(await pinDirectory(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}
async function checkPins(pins: readonly Pin[]): Promise<void> {
  for (const pin of pins) {
    const current = await pinDirectory(pin.location);
    if (!sameIdentity(pin.stat, current.stat)) throw new Error("Project input parent directory changed");
  }
}
async function checkSource(file: InputFile): Promise<void> {
  await checkPins(file.parents);
  if (!sameFile(file.stat, await fs.lstat(file.location, { bigint: true }))) throw new Error(`Project input changed: ${file.name}`);
}
async function optionalStat(location: string): Promise<Stats | undefined> {
  try { return await fs.lstat(location, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Prepare a bounded, immutable inventory. Source paths are deliberately kept in the closure. */
export async function prepareMainProjectInputs(
  inputs: readonly MainProjectInput[] | undefined,
  signal?: AbortSignal,
): Promise<PreparedMainProjectInputs | undefined> {
  signal?.throwIfAborted();
  if (inputs === undefined) return undefined;
  if (!Array.isArray(inputs)) throw new Error("Project inputs must be an array");
  if (!inputs.length) return undefined;
  if (inputs.length > MAX_FILES) throw new Error("Project inputs exceed 1000 files");
  const inventory: InputFile[] = [];
  const names = new Map<string, { name: string; directory: boolean }>();
  const identities = new Set<string>();
  let total = 0;
  let entries = 0;
  function claim(name: string, directory: boolean): void {
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/");
      const isDirectory = i < parts.length || directory;
      const key = prefix.normalize("NFC").toLowerCase();
      const previous = names.get(key);
      if (previous && (previous.name !== prefix || !previous.directory || !isDirectory)) {
        throw new Error(`Duplicate or conflicting project input path: ${name}`);
      }
      names.set(key, { name: prefix, directory: isDirectory });
    }
  }
  async function visit(location: string, name: string, parents: Pin[]): Promise<void> {
    signal?.throwIfAborted();
    safeName(name);
    if (++entries > MAX_ENTRIES) throw new Error("Project input traversal exceeds 10000 entries");
    await checkPins(parents);
    const stat = await fs.lstat(location, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported project input type: ${name}`);
    const identity = `${stat.dev}:${stat.ino}`;
    if (identities.has(identity)) throw new Error(`Duplicate project input source: ${name}`);
    identities.add(identity);
    claim(name, stat.isDirectory());
    if (stat.isDirectory()) {
      const nested = [...parents, { location, stat }];
      const directory = await fs.opendir(location);
      for await (const entry of directory) await visit(path.join(location, entry.name), `${name}/${entry.name}`, nested);
    } else {
      if (stat.nlink !== 1n) throw new Error(`Hard linked project inputs are not supported: ${name}`);
      total += Number(stat.size);
      if (stat.size > MAX_FILE || total > MAX_TOTAL || inventory.length >= MAX_FILES) {
        throw new Error("Project inputs exceed 50 MiB per file, 200 MiB total, or 1000 files");
      }
      inventory.push({ location, name, parents, stat });
    }
  }
  for (const input of inputs) {
    if (typeof input !== "string" && (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).some((key) => key !== "path" && key !== "name"))) {
      throw new Error("Project input must be a path or an object containing only path and name");
    }
    const source = typeof input === "string" ? input : input.path;
    if (typeof source !== "string" || !path.isAbsolute(source) || source.includes("\0")) throw new Error("Project input source path must be absolute");
    const location = path.resolve(source);
    const name = safeName(typeof input === "string" || input.name === undefined ? path.basename(location) : input.name);
    await visit(location, name, await ancestors(path.dirname(location)));
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name));
  let busy = false;
  let receipt: InstalledFile[] | undefined;
  async function cleanup(files: InstalledFile[], completed: boolean): Promise<void> {
    for (const file of [...files].reverse()) {
      // Never follow replaced parents or delete somebody else's replacement or edited file.
      try {
        await checkPins(file.parents);
        const stat = await optionalStat(file.location);
        if (stat && (completed ? sameFile(file.stat, stat) :
          stat.isFile() && !stat.isSymbolicLink() && sameIdentity(file.stat, stat))) await fs.unlink(file.location);
      } catch { /* Unsafe or unavailable cleanup paths are deliberately left untouched. */ }
    }
  }
  return Object.freeze({
    files: Object.freeze(inventory.map((file) => file.name)),
    async install(destination: string): Promise<void> {
      if (busy) throw new Error("Project input installation or rollback is already in progress");
      if (receipt) throw new Error("Project inputs are already installed; roll back before reinstalling");
      busy = true;
      const created: InstalledFile[] = [];
      try {
        signal?.throwIfAborted();
        if (!path.isAbsolute(destination)) throw new Error("Project input destination must be absolute");
        const root = path.resolve(destination);
        const rootPins = await ancestors(root);
        const directories = new Map<string, Pin>();
        // Inspect every target before creating anything, including case conflicts on case-sensitive hosts.
        for (const file of inventory) {
          await checkSource(file);
          let parent = root;
          let existing = true;
          const parts = file.name.split("/");
          for (let i = 0; i < parts.length; i++) {
            const next = path.join(parent, parts[i]);
            if (existing) {
              const children = await fs.readdir(parent);
              const matches = children.filter((name) => name.normalize("NFC").toLowerCase() === parts[i].normalize("NFC").toLowerCase());
              if (matches.some((name) => name !== parts[i])) throw new Error(`Project input destination case conflict: ${file.name}`);
              const stat = await optionalStat(next);
              if (stat) {
                if (i === parts.length - 1) throw new Error(`Project input destination already exists: ${file.name}`);
                directories.set(next, await pinDirectory(next));
              } else existing = false;
            }
            parent = next;
          }
        }
        for (const file of inventory) {
          signal?.throwIfAborted();
          await checkSource(file);
          await checkPins(rootPins);
          const parentPins = [...rootPins];
          let parent = root;
          for (const component of file.name.split("/").slice(0, -1)) {
            await checkPins(parentPins);
            parent = path.join(parent, component);
            let pin = directories.get(parent);
            if (!pin) {
              await fs.mkdir(parent); // EEXIST means the preflight snapshot changed.
              pin = await pinDirectory(parent);
              directories.set(parent, pin);
            }
            parentPins.push(pin);
          }
          await checkPins(parentPins);
          const target = path.join(root, ...file.name.split("/"));
          const source = await fs.open(file.location, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          try {
            if (!sameFile(file.stat, await source.stat({ bigint: true }))) throw new Error(`Project input changed: ${file.name}`);
            const output = await fs.open(target, "wx", 0o600);
            try {
              created.push({ location: target, stat: await output.stat({ bigint: true }), parents: parentPins });
              const buffer = Buffer.alloc(64 * 1024);
              let copied = 0;
              while (true) {
                signal?.throwIfAborted();
                await checkPins(parentPins);
                const { bytesRead } = await source.read(buffer, 0, buffer.length, copied);
                if (!bytesRead) break;
                copied += bytesRead;
                if (copied > file.stat.size || copied > MAX_FILE) throw new Error(`Project input changed: ${file.name}`);
                let written = 0;
                while (written < bytesRead) {
                  const result = await output.write(buffer, written, bytesRead - written);
                  if (!result.bytesWritten) throw new Error("Project input copy made no progress");
                  written += result.bytesWritten;
                }
              }
              if (BigInt(copied) !== file.stat.size || !sameFile(file.stat, await source.stat({ bigint: true }))) throw new Error(`Project input changed: ${file.name}`);
              await checkSource(file);
              await checkPins(parentPins);
              const targetStat = await fs.lstat(target, { bigint: true });
              if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1n ||
                !sameIdentity(await output.stat({ bigint: true }), targetStat)) throw new Error(`Project input destination changed: ${file.name}`);
            } finally { await output.close(); }
          } finally { await source.close(); }
          // Capture after closing the write handle, including platforms that finalize timestamps on close.
          const completed = created[created.length - 1];
          await checkPins(completed.parents);
          const finalStat = await fs.lstat(target, { bigint: true });
          if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1n ||
            !sameIdentity(completed.stat, finalStat) || finalStat.size !== file.stat.size) {
            throw new Error(`Project input destination changed: ${file.name}`);
          }
          completed.stat = finalStat;
        }
        receipt = created;
      } catch (error) {
        await cleanup(created, false);
        throw error;
      } finally { busy = false; }
    },
    async rollback(): Promise<void> {
      if (busy) throw new Error("Project input installation or rollback is already in progress");
      busy = true;
      const installed = receipt;
      receipt = undefined;
      try { if (installed) await cleanup(installed, true); }
      finally { busy = false; }
    },
  });
}
