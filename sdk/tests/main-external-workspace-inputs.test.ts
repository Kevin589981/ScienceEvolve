import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareInvocationInputs } from "../src/core/harness-runtime/invocation-inputs.js";
import { MainProjectWorkspaceStore } from "../src/main-project-workspace.js";
import type { AgentRunRequest } from "../src/core/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-external-inputs-")); roots.push(root);
  const data = path.join(root, "data"), workspace = path.join(root, "selected workspace");
  const projectId = "prj_0123456789abcdef0123456789abcdef", invocationId = "inv_inputs";
  const projectPath = path.join(data, "projects", projectId), runtimePath = path.join(projectPath, "runtime", invocationId);
  const owned = path.join(projectPath, "workspaces"), messages = path.join(projectPath, "messages");
  await Promise.all([fs.mkdir(workspace), fs.mkdir(runtimePath, { recursive: true }), fs.mkdir(owned, { recursive: true }), fs.mkdir(messages, { recursive: true })]);
  const inboxPath = path.join(messages, `0001_${invocationId}_to_main.md`);
  await fs.writeFile(inboxPath, "Authoritative inbox 中\n");
  await fs.writeFile(path.join(workspace, "Memory.md"), "Original selected memory\n");
  await fs.writeFile(path.join(owned, "Memory.md"), "Owned memory\n");
  const store = new MainProjectWorkspaceStore(await fs.realpath(data));
  await store.initialize(); await store.bind(projectId, await store.prepare(workspace));
  const request: Parameters<typeof prepareInvocationInputs>[0] = {
    project: { id: projectId, git: { enabled: false, status: "disabled" } } as AgentRunRequest["project"],
    agent: "main", invocationId, projectPath, workspacePath: workspace, inboxPath, runtimePath
  };
  const resolve = (id: string) => store.resolve(id);
  return { root, workspace, projectPath, owned, request, store, resolve };
}

describe("production invocation input staging with trusted external workspace bindings", () => {
  it("stages the actual Inbox in the registered original directory and uses its existing Memory", async () => {
    const { workspace, request, resolve } = await fixture();
    const resolver = vi.fn(resolve);
    const inputs = await prepareInvocationInputs(request, resolver);
    expect(resolver).toHaveBeenCalledWith(request.project.id);
    expect(inputs.workspacePath).toBe(await fs.realpath(workspace));
    expect(inputs.memoryPath).toBe(await fs.realpath(path.join(workspace, "Memory.md")));
    expect(inputs.inboxPath).toBe(await fs.realpath(path.join(workspace, ".scienceevolve", "inbox", `${request.invocationId}.md`)));
    expect(inputs.inboxPath).not.toBe(request.inboxPath);
    const authority = await fs.readFile(request.inboxPath);
    expect(await fs.readFile(inputs.inboxPath)).toEqual(authority);
    expect(inputs.inboxSha256).toBe(createHash("sha256").update(authority).digest("hex"));
    expect(await fs.readFile(inputs.memoryPath, "utf8")).toBe("Original selected memory\n");
    // Recovery must safely replace the read-only mirror on Windows as well.
    await fs.writeFile(request.inboxPath, "Updated authoritative inbox\n");
    const repeated = await prepareInvocationInputs(request, resolve);
    expect(await fs.readFile(repeated.inboxPath, "utf8")).toBe("Updated authoritative inbox\n");
  });

  it("rejects caller-selected external paths without a trusted host binding", async () => {
    const { workspace, request } = await fixture();
    await expect(prepareInvocationInputs(request)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
    await expect(prepareInvocationInputs(request, async () => undefined)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
    await expect(fs.access(path.join(workspace, ".scienceevolve"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a request for a different directory even when another external root is registered", async () => {
    const { request, owned, resolve } = await fixture();
    await expect(prepareInvocationInputs({ ...request, workspacePath: owned }, resolve)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
  });

  it("propagates a binding identity failure without falling back to another same-path directory", async () => {
    const { root, workspace, request, resolve } = await fixture();
    await fs.rename(workspace, path.join(root, "saved-workspace"));
    await fs.mkdir(workspace); await fs.writeFile(path.join(workspace, "Memory.md"), "replacement memory");
    await expect(prepareInvocationInputs(request, resolve)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
    await expect(fs.access(path.join(workspace, ".scienceevolve"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains ordinary owned-workspace staging without a host callback", async () => {
    const { request, owned } = await fixture();
    const inputs = await prepareInvocationInputs({ ...request, workspacePath: owned });
    expect(inputs.workspacePath).toBe(await fs.realpath(owned));
    expect(await fs.readFile(inputs.memoryPath, "utf8")).toBe("Owned memory\n");
    expect(await fs.readFile(inputs.inboxPath)).toEqual(await fs.readFile(request.inboxPath));
  });

  it("stages synthetic production probe IDs in their owned workspace through the real host resolver", async () => {
    const { root, request, workspace, resolve } = await fixture();
    const projectId = "probe-fixture01234", invocationId = "probe-fixture01234-123456", agent = "probe";
    const projectPath = path.join(root, projectId), workspacePath = path.join(projectPath, "workspaces");
    const runtimePath = path.join(projectPath, "runtime", invocationId);
    const inboxPath = path.join(projectPath, "messages", `0001_${invocationId}_to_${agent}.md`);
    await Promise.all([fs.mkdir(workspacePath, { recursive: true }), fs.mkdir(runtimePath, { recursive: true }),
      fs.mkdir(path.dirname(inboxPath), { recursive: true })]);
    await fs.writeFile(path.join(workspacePath, "Memory.md"), "Synthetic probe memory");
    await fs.writeFile(inboxPath, "Synthetic probe input");
    const resolver = vi.fn(resolve);
    const inputs = await prepareInvocationInputs({ ...request,
      project: { id: projectId } as AgentRunRequest["project"],
      agent, invocationId, projectPath, workspacePath, runtimePath, inboxPath
    }, resolver);
    expect(resolver).toHaveBeenCalledWith(projectId);
    expect(await resolve(projectId)).toBeUndefined();
    expect(inputs.workspacePath).toBe(await fs.realpath(workspacePath));
    expect(inputs.workspacePath).not.toBe(await fs.realpath(workspace));
    expect(await fs.readFile(inputs.memoryPath, "utf8")).toBe("Synthetic probe memory");
    expect(await fs.readFile(inputs.inboxPath, "utf8")).toBe("Synthetic probe input");
    expect(await fs.readdir(workspace)).toEqual(["Memory.md"]);
  });

  it.each(["project", "messages", "runtime", "invocation", "authority name"])("keeps the %s boundary enforced with an external binding", async (fault) => {
    const { root, request, resolve, projectPath } = await fixture();
    const altered = { ...request };
    if (fault === "project") altered.projectPath = path.dirname(projectPath);
    if (fault === "messages") {
      altered.inboxPath = path.join(root, path.basename(request.inboxPath));
      await fs.writeFile(altered.inboxPath, "untrusted inbox");
    }
    if (fault === "runtime") {
      altered.runtimePath = path.join(projectPath, "runtime", "inv_another");
      await fs.mkdir(altered.runtimePath);
    }
    if (fault === "invocation") altered.invocationId = "../invalid";
    if (fault === "authority name") {
      altered.inboxPath = path.join(projectPath, "messages", "0001_inv_another_to_main.md");
      await fs.writeFile(altered.inboxPath, "another invocation's inbox");
    }
    await expect(prepareInvocationInputs(altered, resolve)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
  });

  it("rejects an Inbox staging parent junction that redirects writes outside the original workspace", async () => {
    const { root, workspace, request, resolve } = await fixture();
    const outside = path.join(root, "outside"); await fs.mkdir(outside);
    await fs.symlink(outside, path.join(workspace, ".scienceevolve"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepareInvocationInputs(request, resolve)).rejects.toMatchObject({ code: "INVOCATION_INPUT_STAGING_FAILED" });
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
