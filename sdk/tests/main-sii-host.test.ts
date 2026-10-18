import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMainApplicationRuntime, type MainApplicationRuntime } from "../src/main-runtime.js";
import { createMainResearchSdk } from "../src/main-client.js";
import { SiiExperimentService } from "../src/core/sii-experiments.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import type { HarnessRuntimeOptions } from "../src/core/harness-runtime/runtime.js";
import type { AgentRunRequest } from "../src/core/types.js";

const roots: string[] = [];
const runtimes: MainApplicationRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()));
  vi.restoreAllMocks();
  // These targets are exclusively allocated by this test's mkdtemp calls.
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-sii-host-")); roots.push(root);
  const workspaceRoot = path.join(root, "workspace"); await fs.mkdir(workspaceRoot);
  // Deliberately nonexistent: starting an empty host must never install/login or invoke CLI.
  return { dataDir: path.join(root, "data"), sii: { inspireBin: path.join(root, "uninstalled-inspire"), workspaceRoot, refreshMs: 1000 } };
}

describe("SDK SII service host lifecycle (local only, no platform/model requests)", () => {
  it("drains an aborted submission's ambiguity write and rejects new work before stop resolves", async () => {
    const options = await fixture();
    const projectId = `prj_${"a".repeat(32)}`;
    const projectPath = path.join(options.dataDir, "projects", projectId);
    const workspacePath = path.join(projectPath, "workspaces");
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, "Memory.md"), "Retained task memory.");
    let started!: () => void; const creating = new Promise<void>(resolve => { started = resolve; });
    let aborted!: () => void; const cancelled = new Promise<void>(resolve => { aborted = resolve; });
    let settle!: () => void; const settlement = new Promise<void>(resolve => { settle = resolve; });
    const service = new SiiExperimentService({ ...options.sii, workspaceRoot: projectPath, projectsRoot: path.dirname(projectPath),
      knowledgeRoot: options.sii.workspaceRoot, accountReader: async () => "fixture-account",
      runJson: async (_args, _cwd, signal) => {
        signal!.addEventListener("abort", aborted, { once: true }); started();
        await settlement; throw new Error("fixture ambiguous aborted submission");
      }
    });
    await service.start(); await service.refreshNow();
    const request = { project: { id: projectId, orchestration: { schemaVersion: 1 }, agents: { execution: { harness: "codex", experimentMcp: true } } }, agent: "execution", kind: "worker",
      permission: "compute", invocationId: "fixture-invocation", taskSessionId: "fixture-task",
      projectPath, workspacePath } as unknown as AgentRunRequest;
    const binding = await service.bind(request, new AbortController().signal);
    binding.session = { schemaVersion: 1, harnessId: "codex", adapterVersion: "1", generation: 0,
      nativeId: "fixture-session", durable: true, createdAt: new Date().toISOString() };
    binding.activate();
    const call = binding.call("sii_submit_experiment", { request_id: "fixture-run",
      args: ["job", "create", "--name", "fixture-job", "--workspace", "fixture-space", "--project", "具有能动性的科学大模型"] });
    try {
      await creating;
      let stopped = false;
      const stop = service.stop().then(() => { stopped = true; });
      await cancelled;
      await expect(binding.call("sii_command", { args: ["--help"] })).rejects.toThrow();
      await expect(service.bind(request, new AbortController().signal)).rejects.toThrow();
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(stopped).toBe(false);
      settle(); await stop; await call;
      const ledger = await service.document(projectPath);
      expect(ledger.experiments[0]).toMatchObject({ status: "submission_unknown", queryError: expect.stringContaining("fixture ambiguous") });
      await expect(service.mutate(projectPath, () => undefined)).rejects.toThrow(/stopped/);
      await expect(service.start()).rejects.toThrow();
      await service.refreshNow();
      expect(await service.document(projectPath)).toEqual(ledger);
    } finally { settle(); await call; await service.stop(); }
  });
  it("is disabled by default", async () => {
    const start = vi.spyOn(SiiExperimentService.prototype, "start");
    const stop = vi.spyOn(SiiExperimentService.prototype, "stop");
    const { dataDir } = await fixture();
    const sdk = await createMainResearchSdk({ dataDir });
    try { expect(await sdk.listRuns()).toEqual([]); } finally { await sdk.close(); }
    expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });

  it("registers formal storage before engine recovery and monitoring, forwards host options, and stops once on concurrent close", async () => {
    const options = await fixture();
    const startActual = SiiExperimentService.prototype.start;
    const configure = vi.spyOn(SiiExperimentService.prototype, "configureDocumentStore");
    const initialize = vi.spyOn(Orchestrator.prototype, "initialize");
    let service: SiiExperimentService | undefined;
    const start = vi.spyOn(SiiExperimentService.prototype, "start").mockImplementation(async function () {
      service = this;
      expect((await fs.stat(this.options.projectsRoot)).isDirectory()).toBe(true);
      expect(configure.mock.instances.at(-1)).toBe(this);
      expect(configure.mock.calls.at(-1)![0].source).toMatchObject({ protocol: "project-state-v1", kind: "sqlite",
        databasePath: path.join(options.dataDir, "collaboration-state.sqlite") });
      await startActual.call(this);
    });
    const stop = vi.spyOn(SiiExperimentService.prototype, "stop");
    const runtime = await createMainApplicationRuntime(options); runtimes.push(runtime);
    expect(configure.mock.invocationCallOrder[0]).toBeLessThan(initialize.mock.invocationCallOrder[0]);
    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    const hostOptions = (runtime.runner as unknown as { options: HarnessRuntimeOptions }).options;
    expect(hostOptions.siiExperiments).toBe(service);
    expect(hostOptions.inspireWorkspaceRoot).toBe(options.sii.workspaceRoot);
    expect(hostOptions.inspireBin).toBeUndefined();
    expect(await fs.readFile(path.join(service!.options.knowledgeRoot, "SKILL.md"), "utf8")).toContain("inspire");
    expect(await service!.options.resolveProjectWorkspace!("prj_" + "a".repeat(32))).toBeUndefined();
    await Promise.all([runtime.close(), runtime.close()]);
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(options.dataDir, ".scienceevolve-runtime.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    const reopened = await createMainApplicationRuntime(options); runtimes.push(reopened);
    await reopened.close();
  });

  it("public SDK forwards explicit SII configuration including custom knowledge", async () => {
    const options = await fixture();
    const start = vi.spyOn(SiiExperimentService.prototype, "start");
    const stop = vi.spyOn(SiiExperimentService.prototype, "stop");
    const sdk = await createMainResearchSdk({ ...options, sii: { ...options.sii, knowledgeRoot: options.sii.workspaceRoot } });
    try {
      expect(start).toHaveBeenCalledTimes(1);
      expect((start.mock.instances[0] as SiiExperimentService).options.knowledgeRoot).toBe(options.sii.workspaceRoot);
    } finally { await sdk.close(); }
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.each(["service", "engine"])("stops the service and releases the writer lock on %s initialization failure", async phase => {
    const options = await fixture();
    if (phase === "service") {
      const actual = SiiExperimentService.prototype.start;
      vi.spyOn(SiiExperimentService.prototype, "start").mockImplementation(async function () {
        await actual.call(this); throw new Error("fixture startup failure");
      });
    } else {
      vi.spyOn(Orchestrator.prototype, "initialize").mockRejectedValueOnce(new Error("fixture startup failure"));
    }
    const stop = vi.spyOn(SiiExperimentService.prototype, "stop");
    await expect(createMainApplicationRuntime(options)).rejects.toThrow("fixture startup failure");
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(fs.access(path.join(options.dataDir, ".scienceevolve-runtime.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not own internal caller-provided services and rejects ambiguous ownership before creating data", async () => {
    const options = await fixture();
    const service = new SiiExperimentService({ ...options.sii, projectsRoot: path.join(options.dataDir, "projects"), knowledgeRoot: options.sii.workspaceRoot });
    const start = vi.spyOn(service, "start"); const stop = vi.spyOn(service, "stop");
    await expect(createMainApplicationRuntime({ ...options, runnerOptions: { siiExperiments: service } })).rejects.toThrow(/not both/);
    await expect(fs.access(options.dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    const runtime = await createMainApplicationRuntime({ dataDir: options.dataDir, runnerOptions: { siiExperiments: service } }); runtimes.push(runtime);
    await runtime.close();
    expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  });
});
