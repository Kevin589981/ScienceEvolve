import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const cli = fileURLToPath(new URL("../cli/scienceevolve.mjs", import.meta.url));

it("rejects removed engines before creating or reading runtime data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "scienceevolve-main-only-"));
  try {
    for (const engine of ["legacy", "typo"]) {
      const result = spawnSync(process.execPath, [cli, "run", "list", `--engine=${engine}`,
        "--data-dir", path.join(root, "must-not-be-created")], { encoding: "utf8", timeout: 10_000 });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ type: "error", message: expect.stringContaining("Only the main engine") });
      expect(result.stdout).toBe("");
    }
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps version and help available without a runtime directory", async () => {
  const info = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const flags of [[], ["--engine", "main"]]) {
    const version = spawnSync(process.execPath, [cli, "version", ...flags], { encoding: "utf8", timeout: 10_000 });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(info.version);
    const help = spawnSync(process.execPath, [cli, "--help", ...flags], { encoding: "utf8", timeout: 10_000 });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: scievolve");
    expect(help.stdout).not.toContain("--engine legacy");
  }
});
