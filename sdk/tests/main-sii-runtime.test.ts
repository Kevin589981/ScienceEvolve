import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SiiExperimentService } from "../src/core/sii-experiments.js";
import { HarnessRuntimeFacade } from "../src/core/harness-runtime/runtime.js";
import type { AgentRunRequest, ProjectState } from "../src/core/types.js";
import type { HarnessAdapter, HarnessAdapterContext, HarnessAdapterRequest, HarnessDescriptor, InvocationInputs, SessionRef } from "../src/core/harness-runtime/contracts.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});
const descriptor: HarnessDescriptor = {
  schemaVersion: 1,
  id: "fixture-harness",
  label: "Fixture Harness",
  adapterVersion: "7",
  nativeProtocol: "chat-completions",
  purposes: ["workflow", "explainer", "probe"],
  executableEnv: "FIXTURE_HARNESS_BIN",
  defaultCommand: "fixture-harness",
  default: true,
  notes: "contract fixture",
  explainerIsolation: "adapter-read-only-tools",
  capabilities: {
    structuredEvents: true,
    toolResults: true,
    durableSession: true,
    permissionPrompts: ["workspace", "compute", "yolo"],
    workspaceInputs: true,
    autoSkills: true,
    officialEvents: true,
    toolEvents: true,
    usageEvents: true,
    readOnlyExplainer: true,
    webSearch: true,
    skills: true,
    mcp: true
  }
};

class FixtureAdapter implements HarnessAdapter {
  readonly descriptor = descriptor;
  readonly createdGenerations: number[] = [];
  async resolveExecutable() { return process.execPath; }
  async fingerprint() { return "fixture-fingerprint"; }
  validateNativeSession(id: string) { return id.startsWith("fixture-native-"); }
  sessionFromLegacyId() { return undefined; }
  sessionToLegacyId(session: SessionRef) { return session.nativeId; }
  createSession(_request: HarnessAdapterRequest, _inputs: InvocationInputs, generation: number, durable: boolean): SessionRef {
    this.createdGenerations.push(generation);
    return { schemaVersion: 1, harnessId: descriptor.id, adapterVersion: descriptor.adapterVersion,
      generation, nativeId: `fixture-native-${generation}`, durable, createdAt: new Date().toISOString() };
  }
  async run(_context: HarnessAdapterContext) { return { handoff: "fixture" }; }
}
async function request(
  root: string,
  overrides: Partial<AgentRunRequest> = {}
): Promise<AgentRunRequest> {
  const projectPath = path.join(root, "prj_fixture");
  const workspacePath = path.join(projectPath, "workspaces");
  const messagesPath = path.join(projectPath, "messages");
  const runtimePath = path.join(projectPath, "runtime", "inv_fixture");
  const inboxPath = path.join(messagesPath, "0001_inv_fixture_to_main.md");
  await Promise.all([
    fs.mkdir(workspacePath, { recursive: true }),
    fs.mkdir(messagesPath, { recursive: true }),
    fs.mkdir(runtimePath, { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(inboxPath, "authoritative inbox\n", "utf8"),
    fs.writeFile(path.join(workspacePath, "Memory.md"), "persistent memory\n", "utf8")
  ]);
  const project = {
    id: "prj_fixture",
    agents: {
      main: {
        model: "fixture-model",
        harness: descriptor.id,
        gatewayId: "gwy_fixture",
        gatewaySnapshot: {
          id: "gwy_fixture",
          name: "Fixture gateway",
          url: "https://gateway.example.test/v1",
          apiKey: "upstream-secret",
          models: ["fixture-model"],
          defaultModel: "fixture-model",
          protocol: "responses",
          nativeProtocol: descriptor.nativeProtocol,
          routeMode: "proxy"
        },
        skills: [],
        autoSkills: [],
        mcpServers: [],
        instructions: "Fixture mandate.",
        reasoningEffort: "high",
        permission: "workspace",
        webSearch: false,
        sessionPersistence: true,
        decisionBy: "main"
      }
    },
    agentSessionIds: {},
    agentSessions: {},
    agentSessionMeta: {}
  } as unknown as ProjectState;
  return {
    project,
    agent: "main",
    kind: "main",
    permission: "workspace",
    invocationId: "inv_fixture",
    inboxPath,
    projectPath,
    workspacePath,
    schemaPath: path.join(projectPath, "schema.json"),
    skillPaths: [],
    autoSkillPaths: [],
    availableSkillPaths: [],
    runtimePath,
    onModelActivity: vi.fn(),
    ...overrides
  };
}

describe("SDK SII actual runtime facade with simulated native turns (no platform calls)", () => {
  it("yields an unfinished SII turn and resumes the identical native session before returning its final task result", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-sii-facade-")); roots.push(root);
    const runRequest = await request(root, { permission: "workspace", taskSessionId: "sii-task", kind: "worker", agent: "experimenter" });
    runRequest.project.agents.experimenter = { ...runRequest.project.agents.main!, experimentMcp: true };
    runRequest.inboxPath = runRequest.inboxPath.replace("_to_main.md", "_to_experimenter.md");
    await fs.rename(path.join(runRequest.projectPath, "messages", "0001_inv_fixture_to_main.md"), runRequest.inboxPath);
    const oldProject = runRequest.projectPath;
    const id = "prj_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const projectPath = path.join(root, id);
    await fs.rename(oldProject, projectPath);
    for (const key of ["projectPath", "workspacePath", "runtimePath", "inboxPath", "schemaPath"] as const) runRequest[key] = runRequest[key].replace(oldProject, projectPath);
    runRequest.project.id = id;
    runRequest.project.orchestration = { schemaVersion: 1 } as ProjectState["orchestration"];
    let status = "job_running";
    const service = new SiiExperimentService({ projectsRoot: root, inspireBin: "unused", workspaceRoot: root,
      knowledgeRoot: root, refreshMs: 3_600_000, accountReader: async () => "test-account",
      runJson: async args => ({ success: true, data: args.includes("create") ? { name: "native-run" } : { job: { status } } }) });
    await service.start(); await service.refreshNow();
    const adapter = new FixtureAdapter();
    const invocations: HarnessAdapterContext[] = [];
    const officialIds: string[] = [];
    runRequest.onOfficialHarnessEvent = event => { officialIds.push(String(event.eventId)); };
    vi.spyOn(adapter, "run").mockImplementation(async context => {
      invocations.push(context);
      await context.onEvent({ schemaVersion: 1, eventId: "native:0", seq: 0, timestamp: new Date().toISOString(), invocationId: context.spec.invocationId,
        harnessId: context.spec.harnessId, kind: "assistant.message", phase: "completed", message: `native turn ${invocations.length}` });
      if (invocations.length === 1) {
        const client = new Client({ name: "native-agent", version: "1" });
        await client.connect(new StreamableHTTPClientTransport(new URL(context.request.siiMcp!.url)));
        try {
          const submission = await client.callTool({ name: "sii_submit_experiment", arguments: { request_id: "native-run", args: ["job", "create", "--name", "native-run", "--workspace", "space", "--project", "具有能动性的科学大模型"] } });
          expect(submission.isError).not.toBe(true);
          const experiment = (submission.structuredContent as { experiment: { id: string } }).experiment;
          const deferred = await client.callTool({ name: "sii_defer_task", arguments: { experiment_ids: [experiment.id], context: "Read metrics and validate the result." } });
          expect(deferred.isError).not.toBe(true);
        } finally { await client.close(); }
        return { threadId: context.spec.session!.nativeId, handoff: "Task pending experiment; continue when notified." };
      }
      expect(context.spec.prompt).toContain("sii_get_task_context");
      expect(context.spec.prompt).not.toContain("Read metrics and validate the result.");
      const client = new Client({ name: "resumed-native-agent", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(context.request.siiMcp!.url)));
      try {
        const note = await client.callTool({ name: "sii_get_task_context", arguments: { field: "context" } });
        expect(note.isError).not.toBe(true);
        expect(note.structuredContent).toMatchObject({ content: "Read metrics and validate the result.", nextPage: null });
      } finally { await client.close(); }
      expect(context.spec.prompt).toContain('"status":"succeeded"');
      expect(context.spec.session!.nativeId).toBe(invocations[0]!.spec.session!.nativeId);
      expect(context.spec.session!.generation).toBe(invocations[0]!.spec.session!.generation);
      expect(context.spec.session!.resumedAt).toBeDefined();
      await context.onEvent({ schemaVersion: 1, eventId: "native-user:1", seq: 1, timestamp: new Date().toISOString(),
        invocationId: context.spec.invocationId, harnessId: context.spec.harnessId, kind: "user.message", phase: "completed", message: context.spec.prompt });
      return { threadId: context.spec.session!.nativeId, handoff: "Measured results validated; task complete." };
    });
    const onExperimentWait = vi.fn(async (_waiting: boolean) => undefined);
    runRequest.onExperimentWait = onExperimentWait;
    const facade = new HarnessRuntimeFacade({ adapters: [adapter], siiExperiments: service,
      protocolProxyFactory: vi.fn(async () => ({ baseUrl: "http://127.0.0.1:43199/v1", token: "test-route", close: async () => undefined })) });
    let taskFinished = false;
    const running = facade.run(runRequest, vi.fn(), new AbortController().signal).then(result => { taskFinished = true; return result; });
    void running.catch(() => undefined);
    try {
      await Promise.race([vi.waitFor(() => expect(onExperimentWait).toHaveBeenCalledWith(true)), running.then(() => { throw new Error("Task returned before experiment wait"); })]);
      expect(taskFinished).toBe(false); expect(invocations).toHaveLength(1);
      await service.refreshNow(); expect(invocations).toHaveLength(1);
      status = "job_succeeded";
      await service.mutate(projectPath, doc => { doc.experiments[0]!.nextCheckAt = 0; }); await service.refreshNow();
      expect((await running).handoff).toBe("Measured results validated; task complete.");
      expect(invocations).toHaveLength(2); expect(adapter.createdGenerations).toEqual([0]);
      expect(officialIds).toHaveLength(3); expect(new Set(officialIds).size).toBe(3);
      expect(onExperimentWait.mock.calls.map(args => args[0])).toEqual([true, false]);
      expect((await service.document(projectPath)).waits).toEqual([]);
    } finally { await service.stop(); }
  });
});
