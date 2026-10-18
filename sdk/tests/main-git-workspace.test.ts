import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MainSourceWorkspaceStore } from "../src/main-source-workspace.js";
import { MainGitWorkspaceStore } from "../src/main-git-workspace.js";
import type { ProjectView } from "../src/core/types.js";

const roots: string[] = [];
const id = "prj_0123456789abcdef0123456789abcdef";
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }))); });
async function fixture(gitSource = false, empty = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-sdk-return-workspace-")); roots.push(root);
  const data = path.join(root, "data"), workspace = path.join(root, "original"), project = path.join(data, "projects", id);
  await fs.mkdir(project, { recursive: true }); await fs.mkdir(workspace);
  if (!empty) {
    await fs.writeFile(path.join(workspace, "change.txt"), "original dirty contents\n");
    await fs.writeFile(path.join(workspace, "delete.txt"), "remove me\n");
    await fs.writeFile(path.join(workspace, "workflow.json"), "user configuration\n");
    await fs.writeFile(path.join(workspace, ".env"), "not imported");
  }
  const sourceGit = (args: string[]) => execFileSync("git", ["-c", `safe.directory=${workspace}`, "-c", "core.autocrlf=false", "-C", workspace, ...args], { encoding: "utf8", windowsHide: true });
  let originalHead: string | undefined, originalIndex: Buffer | undefined;
  if (gitSource) {
    sourceGit(["init", "--initial-branch=main"]); sourceGit(["add", "change.txt", "delete.txt", "workflow.json"]);
    sourceGit(["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-m", "Source history"]);
    await fs.writeFile(path.join(workspace, "change.txt"), "dirty source to import\n");
    await fs.writeFile(path.join(workspace, "untracked.txt"), "untracked safe input\n");
    originalHead = sourceGit(["rev-parse", "HEAD"]); originalIndex = await fs.readFile(path.join(workspace, ".git", "index"));
  }
  const sources = new MainSourceWorkspaceStore(data); await sources.initialize(true);
  const store = new MainGitWorkspaceStore(data, sources); await store.initialize();
  const prepared = await store.prepare(workspace); await store.bind(id, prepared.binding);
  const repository = path.join(project, "repository");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", repository], { encoding: "utf8", windowsHide: true });
  const git = (args: string[], input?: string) => execFileSync("git", ["--git-dir", repository, ...args], { encoding: "utf8", input, windowsHide: true });
  const commit = (files: Record<string, string>) => {
    const tree = git(["mktree", "-z"], Object.entries(files).map(([name, content]) => `100644 blob ${git(["hash-object", "-w", "--stdin"], content).trim()}\t${name}\0`).join("")).trim();
    const sha = git(["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit-tree", tree, "-m", "Integrated fixture"]).trim();
    git(["update-ref", "refs/heads/main", sha]); return sha;
  };
  const result = empty ? { "result.txt": "empty project delivered\n" } : { "change.txt": "integrated final\n", "added.txt": "new output\n", "workflow.json": "user configuration\n", ...(gitSource ? { "untracked.txt": "untracked safe input\n" } : {}) };
  const sha = commit(result);
  const state = { id, status: "completed", completionGeneration: 0, git: { enabled: true, status: "ready", repository: { localPath: repository } } } as unknown as ProjectView;
  return { root, data, workspace, project, repository, store, sources, state, prepared, sha, result, commit, sourceGit, originalHead, originalIndex };
}

describe("Git workspace import and final delivery (actual local Git objects, no provider/model mocks presented as real acceptance)", () => {
  it.each([false, true])("imports current files, delivers only completed integrated results and preserves original Git metadata (Git source %s)", async gitSource => {
    const f = await fixture(gitSource);
    expect(f.prepared.source).not.toBeNull();
    const entries = await f.sources.snapshotEntries(f.prepared.source!);
    expect(entries.map(entry => entry.path)).toContain("workflow.json");
    expect(entries.map(entry => entry.path)).not.toContain(".env");
    expect((await f.store.synchronize({ ...f.state, status: "running" })).status).toBe("pending");
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).not.toBe("integrated final\n");
    const receipt = await f.store.synchronize(f.state);
    expect(receipt).toMatchObject({ status: "synced", commit: f.sha, destination: await fs.realpath(f.workspace), generation: 0 });
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("integrated final\n");
    expect(await fs.readFile(path.join(f.workspace, "added.txt"), "utf8")).toBe("new output\n");
    await expect(fs.access(path.join(f.workspace, "delete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(f.workspace, ".env"), "utf8")).toBe("not imported");
    expect(await fs.readFile(path.join(f.workspace, "workflow.json"), "utf8")).toBe("user configuration\n");
    if (gitSource) {
      expect(f.sourceGit(["rev-parse", "HEAD"])).toBe(f.originalHead);
      expect(await fs.readFile(path.join(f.workspace, ".git", "index"))).toEqual(f.originalIndex);
    }
    await fs.writeFile(path.join(f.workspace, "change.txt"), "edited after delivery");
    const reopened = new MainGitWorkspaceStore(f.data, f.sources); await reopened.initialize();
    expect(await reopened.synchronize(f.state)).toEqual(receipt);
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("edited after delivery");
  });
  it("accepts an empty existing project", async () => {
    const f = await fixture(false, true);
    expect(f.prepared.source).toBeNull();
    expect(await f.store.synchronize(f.state)).toMatchObject({ status: "synced" });
    expect(await fs.readFile(path.join(f.workspace, "result.txt"), "utf8")).toBe("empty project delivered\n");
  });
  it("treats prototype-named files as ordinary manifest entries across delivery, recovery and deletion", async () => {
    const f = await fixture(false, true);
    const names = ["constructor", "toString", "__proto__"];
    const output = Object.fromEntries(names.map(name => [name, `first ${name}\n`]));
    f.commit(output);
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === path.join(f.workspace, "toString")) throw new Error("Injected prototype filename retry");
      return rename(from, to);
    });
    expect(await f.store.synchronize(f.state)).toMatchObject({ status: "failed", message: "Injected prototype filename retry" });
    spy.mockRestore();
    const reopened = new MainGitWorkspaceStore(f.data, f.sources); await reopened.initialize();
    expect(await reopened.synchronize(f.state, true)).toMatchObject({ status: "synced" });
    for (const name of names) expect(await fs.readFile(path.join(f.workspace, name), "utf8")).toBe(output[name]);
    f.commit({ constructor: "updated constructor\n" });
    const restored = new MainGitWorkspaceStore(f.data, f.sources); await restored.initialize();
    expect(await restored.synchronize({ ...f.state, completionGeneration: 1 })).toMatchObject({ status: "synced", generation: 1 });
    expect(await fs.readFile(path.join(f.workspace, "constructor"), "utf8")).toBe("updated constructor\n");
    for (const name of names.slice(1)) await expect(fs.access(path.join(f.workspace, name))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preflights every conflict before any delivery writes, preserves staged output and explicitly retries", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.workspace, "change.txt"), "user edits during run");
    expect(await f.store.synchronize(f.state)).toMatchObject({ status: "conflict", conflicts: ["change.txt"] });
    await expect(fs.access(path.join(f.workspace, "added.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(f.workspace, "delete.txt"), "utf8")).toBe("remove me\n");
    await fs.writeFile(path.join(f.workspace, "change.txt"), "original dirty contents\n");
    const reopened = new MainGitWorkspaceStore(f.data, f.sources); await reopened.initialize();
    expect((await reopened.synchronize(f.state))!.status).toBe("conflict");
    expect((await reopened.synchronize(f.state, true))!.status).toBe("synced");
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("integrated final\n");
  });
  it("detects a new original file colliding with a newly delivered file", async () => {
    const f = await fixture(); await fs.writeFile(path.join(f.workspace, "added.txt"), "user's new file");
    expect(await f.store.synchronize(f.state)).toMatchObject({ status: "conflict", conflicts: ["added.txt"] });
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("original dirty contents\n");
  });
  it("recovers a durable partial delivery after an atomic replacement fails without reimporting or rewriting delivered files", async () => {
    const f = await fixture();
    const rename = fs.rename.bind(fs);
    const spy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to) === path.join(f.workspace, "change.txt")) throw Object.assign(new Error("Injected replacement failure"), { code: "EACCES" });
      return rename(from, to);
    });
    expect(await f.store.synchronize(f.state)).toMatchObject({ status: "failed", message: "Injected replacement failure" });
    expect(await fs.readFile(path.join(f.workspace, "added.txt"), "utf8")).toBe("new output\n");
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("original dirty contents\n");
    spy.mockRestore();
    const registry = JSON.parse(await fs.readFile(path.join(f.data, "git-workspace-bindings.json"), "utf8"));
    expect(registry.projects[id].journal.changes.length).toBeGreaterThan(1);
    const reopened = new MainGitWorkspaceStore(f.data, f.sources); await reopened.initialize();
    expect((await reopened.synchronize(f.state))!.status).toBe("failed");
    expect(await reopened.synchronize(f.state, true)).toMatchObject({ status: "synced", commit: f.sha });
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("integrated final\n");
    await expect(fs.access(path.join(f.workspace, "delete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(f.workspace, "added.txt"), "utf8")).toBe("new output\n");
  });
  it("pins original-directory identity across reopening rather than silently reverting to an empty project", async () => {
    const f = await fixture(); await fs.rename(f.workspace, path.join(f.root, "moved")); await fs.mkdir(f.workspace);
    await expect(new MainGitWorkspaceStore(f.data, f.sources).initialize()).rejects.toThrow(/changed/);
    await fs.rmdir(f.workspace);
    await expect(new MainGitWorkspaceStore(f.data, f.sources).initialize()).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("never removes someone else's delivery lock and retains a retryable failure", async () => {
    const f = await fixture(), lock = path.join(f.workspace, ".scienceevolve-sdk-delivery.lock");
    await fs.writeFile(lock, "other owner");
    expect((await f.store.synchronize(f.state))!.status).toBe("failed");
    expect(await fs.readFile(lock, "utf8")).toBe("other owner");
    await fs.unlink(lock);
    expect((await f.store.synchronize(f.state))!.status).toBe("failed");
    expect((await f.store.synchronize(f.state, true))!.status).toBe("synced");
  });
  it("uses delivered baseline for a later generation and deduplicates concurrent completion reads", async () => {
    const f = await fixture(); await f.store.synchronize(f.state);
    expect(await f.store.synchronize({ ...f.state, status: "running" })).toMatchObject({ status: "pending" });
    const restored = new MainGitWorkspaceStore(f.data, f.sources); await restored.initialize();
    expect(restored.receipt(id)?.status).toBe("pending");
    const next = { ...f.result, "change.txt": "second generation\n" }; const sha = f.commit(next);
    const state = { ...f.state, completionGeneration: 1 };
    const receipts = await Promise.all([f.store.synchronize(state), f.store.synchronize(state)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(receipts[0]).toMatchObject({ status: "synced", generation: 1, commit: sha });
    expect(await fs.readFile(path.join(f.workspace, "change.txt"), "utf8")).toBe("second generation\n");
  });
});
