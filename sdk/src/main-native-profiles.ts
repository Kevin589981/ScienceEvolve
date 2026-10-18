import { promises as fs } from "node:fs";
import path from "node:path";

/** Explicit deployment authority. No reading/copying auth.json and no native config writes. */
export class MainNativeCodexProfiles {
  #homes: Readonly<Record<string, string>> = {};
  async initialize(dataDir: string, configured: Record<string, string> = {}, fresh: boolean) {
    const homes: Record<string, string> = {};
    for (const [id, input] of Object.entries(configured).sort(([a], [b]) => a.localeCompare(b))) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !path.isAbsolute(input)) throw new Error("Invalid native Codex profile declaration");
      const home = await fs.realpath(input);
      if (!(await fs.stat(home)).isDirectory()) throw new Error("Native Codex profile home must be a directory");
      const config = await fs.lstat(path.join(home, "config.toml"));
      if (!config.isFile() || config.isSymbolicLink()) throw new Error("Native Codex profile requires a regular config.toml");
      homes[id] = home;
    }
    const file = path.join(dataDir, ".scienceevolve-native-codex-profiles.json");
    if (fresh) await fs.writeFile(file, JSON.stringify(homes) + "\n", { flag: "wx", mode: 0o600 });
    else {
      // Previous migration previews did not have native routes. A missing registry
      // can only reopen with no profiles; enabling it requires a new data directory.
      const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && Object.keys(homes).length === 0) return undefined;
        throw error;
      });
      if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256_000)) throw new Error("Native profile registry is not a bounded regular private file");
      const existing = info ? await fs.readFile(file, "utf8") : "{}";
      if (JSON.stringify(JSON.parse(existing)) !== JSON.stringify(homes)) throw new Error("Native Codex profile bindings changed; reopen with the original deployment configuration");
    }
    this.#homes = Object.freeze(homes);
  }
  async resolve(id: string): Promise<string> {
    const home = this.#homes[id];
    if (!home) throw new Error(`Unknown native Codex profile: ${id}`);
    if (await fs.realpath(home) !== home || !(await fs.stat(home)).isDirectory()) throw new Error("Native Codex profile authority changed on disk");
    return home;
  }
}
