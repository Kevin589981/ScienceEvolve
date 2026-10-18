import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { exportMainWorkspace } from "../src/main-workspace.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }))); });
async function fixture(files: Record<string, Buffer | string> = { "README.md": "integrated result\n" }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-main-export-")); roots.push(root);
  const dataDir = path.join(root, "data"), projectDir = path.join(dataDir, "projects", "fixture"), repository = path.join(projectDir, "repository");
  await fs.mkdir(projectDir, { recursive: true });
  const git = (args: string[], input?: Buffer | string) => execFileSync("git", ["-c", "core.autocrlf=false", "--git-dir", repository, ...args],
    { encoding: "utf8", input, windowsHide: true, timeout: 20_000 });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", repository], { encoding: "utf8", windowsHide: true });
  function tree(entries: Array<{ name: string; content: Buffer | string; mode?: string }>) {
    const text = entries.map(({ name, content, mode = "100644" }) => `${mode} blob ${git(["hash-object", "-w", "--stdin"], content).trim()}\t${name}\0`).join("");
    return git(["mktree", "-z"], text).trim();
  }
  const treeSha = tree(Object.entries(files).map(([name, content]) => ({ name, content })));
  const commitTree = (sha: string, branch = "main") => {
    const commit = git(["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit-tree", sha, "-m", "Fixture export"]).trim();
    git(["update-ref", `refs/heads/${branch}`, commit]); return commit;
  };
  const commit = commitTree(treeSha);
  return { root, dataDir, projectDir, repository, git, tree, commitTree, commit,
    options: { destination: path.join(root, "delivery") } };
}

describe("main workspace export: actual bare Git objects, no remote or model", () => {
  it("exports exact text, Unicode and binary blobs from integrated main without Git metadata or ref mutation", async () => {
    const binary = Buffer.from([0, 1, 255, 13, 10, 128]);
    const input = await fixture({ "README.md": "原文\n", "数据.bin": binary });
    const otherTree = input.tree([{ name: "unmerged.txt", content: "not integrated" }]);
    input.commitTree(otherTree, "executions/unmerged");
    const refs = input.git(["show-ref"]);
    const result = await exportMainWorkspace(input);
    expect(result).toEqual({ destination: await fs.realpath(input.options.destination), commit: input.commit, files: 2, bytes: Buffer.byteLength("原文\n") + binary.length });
    expect(await fs.readFile(path.join(result.destination, "README.md"), "utf8")).toBe("原文\n");
    expect(await fs.readFile(path.join(result.destination, "数据.bin"))).toEqual(binary);
    expect(await fs.readdir(result.destination)).toEqual(["README.md", "数据.bin"]);
    expect(input.git(["show-ref"])).toBe(refs);
  });
  it("preserves nested paths and the executable bit where the platform supports it", async () => {
    const input = await fixture();
    const nested = input.tree([{ name: "run.sh", content: "#!/bin/sh\n", mode: "100755" }]);
    const rootTree = input.git(["mktree", "-z"], `040000 tree ${nested}\tscripts\0`).trim();
    input.commitTree(rootTree);
    const result = await exportMainWorkspace(input);
    const file = path.join(result.destination, "scripts", "run.sh");
    expect(await fs.readFile(file, "utf8")).toBe("#!/bin/sh\n");
    if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o100).toBe(0o100);
  });
  it("refuses an existing destination and keeps all user files", async () => {
    const input = await fixture(); await fs.mkdir(input.options.destination);
    const file = path.join(input.options.destination, "user.txt"); await fs.writeFile(file, "keep");
    await expect(exportMainWorkspace(input)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(file, "utf8")).toBe("keep");
    expect(await fs.readdir(input.options.destination)).toEqual(["user.txt"]);
  });
  it("rejects destinations inside runtime data and repository bindings outside this project", async () => {
    const input = await fixture();
    await expect(exportMainWorkspace({ ...input, options: { destination: path.join(input.dataDir, "delivery") } })).rejects.toThrow(/outside runtime/);
    await expect(exportMainWorkspace({ ...input, repository: input.root })).rejects.toThrow(/runtime-owned/);
    await expect(exportMainWorkspace({ ...input, options: { destination: "relative" } })).rejects.toThrow(/absolute/);
    await expect(exportMainWorkspace({ ...input, options: { destination: path.join(input.root, "missing-parent", "delivery") } })).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["..", ".git", "NUL.txt", "bad:ads", "trailing.", "bad\\path"])("rejects unsafe/non-portable Git paths before creating output (%s)", async (name) => {
    const input = await fixture({ [name]: "unsafe fixture" });
    await expect(exportMainWorkspace(input)).rejects.toThrow(/unsafe workspace path/);
    await expect(fs.access(input.options.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects case collisions before creating output", async () => {
    const input = await fixture({ "File.txt": "one", "file.txt": "two" });
    await expect(exportMainWorkspace(input)).rejects.toThrow(/collision/);
    await expect(fs.access(input.options.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses Git symlinks without requiring OS symlink privileges", async () => {
    const input = await fixture();
    const tree = input.tree([{ name: "link", content: "../../outside", mode: "120000" }]); input.commitTree(tree);
    await expect(exportMainWorkspace(input)).rejects.toThrow(/symlinks and submodules/);
    await expect(fs.access(input.options.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects a pre-aborted export without creating a directory or modifying the repository", async () => {
    const input = await fixture(); const controller = new AbortController(); controller.abort(new Error("fixture aborted"));
    await expect(exportMainWorkspace({ ...input, options: { ...input.options, signal: controller.signal } })).rejects.toThrow(/fixture aborted/);
    await expect(fs.access(input.options.destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(input.git(["rev-parse", "main"])).toContain(input.commit);
  });
});
