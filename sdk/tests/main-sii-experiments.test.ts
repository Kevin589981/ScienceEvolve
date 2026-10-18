import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SiiExperimentService, assertSiiControlAction, type SiiMcpBinding } from "../src/core/sii-experiments.js";
import { ControlActionService } from "../src/core/orchestration-control-bridge.js";
import { ProjectInspireWorkloadRegistry } from "../src/core/inspire-workload-registry.js";
import type { AgentRunRequest } from "../src/core/types.js";
import type { SessionRef } from "../src/core/harness-runtime/contracts.js";

// Windows cannot exec a shebang .cjs file. Only fixture executables get Node's
// explicit script argument; production CLI construction and actual child I/O stay exercised.
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: Parameters<typeof actual.execFile>) => {
    if (process.platform === "win32" && typeof args[0] === "string" && /inspire-(?:fixture|progress)\.cjs$/.test(args[0])) {
      return actual.execFile(process.execPath, [args[0], ...(args[1] as string[])], args[2] as never, args[3] as never);
    }
    return actual.execFile(...args);
  } };
});

const PROJECT = "prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const services: SiiExperimentService[] = [];
const roots: string[] = [];
const session: SessionRef = { schemaVersion: 1, harnessId: "codex", adapterVersion: "1", generation: 0, nativeId: "original-thread", durable: true, createdAt: "2026-10-07T00:00:00.000Z" };
async function receiveNotification(binding: SiiMcpBinding, text: string) {
  await binding.beginResume(); binding.activate();
  await binding.observeNativeNotification({ kind: "user.message", phase: "completed", eventId: "native-user-result",
    invocationId: binding.request.invocationId, harnessId: session.harnessId, message: text }, session);
}
async function receiveResult(binding: SiiMcpBinding, result: unknown) {
  await binding.observeNativeResult({ kind: "tool.completed", phase: "completed", eventId: "native-sii-result",
    invocationId: binding.request.invocationId, harnessId: session.harnessId,
    tool: { name: "mcp__scienceevolve-sii__sii_get_experiment", callId: "native-query-call",
      status: "completed", outputPreview: JSON.stringify(result) } }, session);
}
afterEach(async () => {
  await Promise.all(services.splice(0).map(s => s.stop()));
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-sii-")); roots.push(root);
  const projectPath = path.join(root, "projects", PROJECT);
  const workspacePath = path.join(projectPath, "workspaces");
  const knowledgeRoot = path.join(root, "knowledge");
  await fs.mkdir(workspacePath, { recursive: true }); await fs.mkdir(path.join(knowledgeRoot, "references"), { recursive: true });
  await fs.writeFile(path.join(workspacePath, "Memory.md"), "Original task memory");
  await fs.writeFile(path.join(knowledgeRoot, "SKILL.md"), "Original resource and path knowledge");
  await fs.writeFile(path.join(knowledgeRoot, "references", "notebook.md"), "Original notebook capabilities");
  let platformState = "job_running";
  let queryFailure = false;
  let createFailure = false;
  const runJson = vi.fn(async (args: string[]) => {
    if (args.includes("create")) { if (createFailure) throw new Error("response lost"); return { success: true, data: { name: "training-a", sub_code: 0 } }; }
    if (args.includes("status")) { if (queryFailure) throw new Error("network unavailable"); return { success: true, data: { job: { status: platformState, exit_code: platformState.includes("failed") ? 2 : 0 } } }; }
    return { success: true, data: { args } };
  });
  const options = { projectsRoot: path.join(root, "projects"), inspireBin: "unused", workspaceRoot: root, knowledgeRoot, refreshMs: 3_600_000, runJson, accountReader: async () => "account-a" };
  const service = new SiiExperimentService(options); services.push(service);
  await service.start(); await service.refreshNow();
  const onExperimentWait = vi.fn(async (_waiting: boolean) => undefined);
  const request = { project: { id: PROJECT, orchestration: { schemaVersion: 1 }, agents: { execution: { harness: "codex", experimentMcp: true } } },
    agent: "execution", kind: "worker", permission: "compute", invocationId: "inv_first", taskSessionId: "original-task",
    projectPath, workspacePath, runtimePath: path.join(projectPath, "runtime", "inv_first"), onExperimentWait } as unknown as AgentRunRequest;
  const binding = await service.bind(request, new AbortController().signal); binding.session = session; binding.activate();
  const submit = (kind = "job", extra: Record<string, unknown> = {}) => binding.call("sii_submit_experiment", { args: [kind, "create", "--name", "training-a", "--workspace", "compute-space", "--project", "具有能动性的科学大模型", "--command", "python train.py"], request_id: "run-a", ...extra }) as Promise<{ experiment: { id: string; runId: string; status: string } }>;
  const due = () => service.mutate(projectPath, doc => { for (const e of doc.experiments) e.nextCheckAt = 0; });
  return { root, options, service, binding, request, runJson, onExperimentWait, submit, due,
    state: (value: string) => { platformState = value; }, failQueries: () => { queryFailure = true; }, failCreate: () => { createFailure = true; } };
}

describe("SII asynchronous experiments", () => {
  it("accepts only an exact trusted external Git-off workspace and fails closed on resolver errors", async () => {
    const f = await fixture();
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-sii-external-")); roots.push(external);
    await fs.writeFile(path.join(external, "Memory.md"), "Original task memory");
    const nested = path.join(external, "nested"); await fs.mkdir(nested);
    const resolveProjectWorkspace = vi.fn(async () => external);
    const service = new SiiExperimentService({ ...f.options, resolveProjectWorkspace });
    services.push(service); await service.start();
    const request = { ...f.request, project: { ...f.request.project, git: { enabled: false } }, workspacePath: external } as AgentRunRequest;
    await expect(f.service.bind(request, new AbortController().signal)).rejects.toThrow(/outside/);
    const binding = await service.bind(request, new AbortController().signal); binding.session = session; binding.activate();
    expect(resolveProjectWorkspace).toHaveBeenCalledWith(PROJECT);
    const marker = path.join(external, "done.json");
    await binding.call("sii_register_experiment", { kind: "notebook", name: "existing-resource", workspace: "compute-space", request_id: "external-run", completion_file: marker });
    await fs.writeFile(marker, JSON.stringify({ run_id: "external-run", exit_code: 0 }));
    await service.refreshNow();
    expect((await service.document(f.request.projectPath)).experiments[0]?.status).toBe("succeeded");
    await expect(service.bind({ ...request, workspacePath: nested }, new AbortController().signal)).rejects.toThrow(/outside/);
    await expect(service.bind({ ...request, project: { ...request.project, git: { ...request.project.git, enabled: true } } }, new AbortController().signal)).rejects.toThrow(/outside/);
    resolveProjectWorkspace.mockRejectedValueOnce(new Error("trusted binding unavailable"));
    await expect(service.bind(request, new AbortController().signal)).rejects.toThrow();
  });
  it("exposes full CLI and original knowledge through real MCP without shell expansion", async () => {
    const f = await fixture();
    const client = new Client({ name: "agent", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(f.binding.url)));
    try {
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain("sii_defer_task");
      const command = ["notebook", "exec", "cpu-box", "python -c 'print(\"$HOME; $(never)\")'"];
      const result = await client.callTool({ name: "sii_command", arguments: { args: command } });
      expect(result.isError).not.toBe(true);
      expect(f.runJson.mock.calls.at(-1)?.[0]).toEqual(command);
      const knowledge = await client.callTool({ name: "sii_read_knowledge", arguments: { path: "references/notebook.md" } });
      expect(JSON.stringify(knowledge)).toContain("Original notebook capabilities");
      await expect(f.binding.call("sii_read_knowledge", { path: "../secret.md" })).rejects.toThrow();
    } finally { await client.close(); }
  });

  it("executes the actual CLI bridge with literal arguments and recognizes explicit nonzero JSON rejection", async () => {
    const f = await fixture();
    const executable = path.join(f.root, "inspire-fixture.cjs");
    await fs.writeFile(executable, "#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args.includes('--help')){process.stdout.write('fixture CLI help');process.exit(0)};const failed=args.includes('create');process.stdout.write(JSON.stringify({success:!failed,message:failed?'quota rejected':undefined,data:{args,configPath:process.env.INSPIRE_GLOBAL_CONFIG_PATH,hasProxy:['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'].some(k=>!!process.env[k])}}));if(failed)process.exitCode=2;\n", { mode: 0o700 });
    const service = new SiiExperimentService({ ...f.options, inspireBin: executable, configPath: "/test/config", runJson: undefined });
    services.push(service); await service.start(); await service.refreshNow();
    const binding = await service.bind({ ...f.request, invocationId: "inv_cli" }, new AbortController().signal); binding.session = session; binding.activate();
    const args = ["notebook", "exec", "cpu-box", "echo $(never) $HOME ; no-shell"];
    const result = await binding.call("sii_command", { args }) as { result: { data: Record<string, unknown> } };
    expect(result.result.data).toMatchObject({ args: ["--no-env-file", "--json", ...args], configPath: "/test/config", hasProxy: false });
    expect(JSON.stringify(await binding.call("sii_command", { args: ["job", "--help"] }))).toContain("fixture CLI help");
    const submission = await binding.call("sii_submit_experiment", { request_id: "rejected-run", args: ["job", "create", "--name", "rejected-run", "--workspace", "space", "--project", "具有能动性的科学大模型"] }) as { experiment: { status: string }; message: string };
    expect(submission.experiment.status).toBe("failed");
    expect(submission.message).toContain("明确拒绝");
    expect((await service.document(f.request.projectPath)).experiments[0]!.evidence).toMatchObject({ message: "quota rejected" });
  });

  it("preserves textual CLI operations and parses progress-prefixed JSON without mistaking textual creation for success", async () => {
    const f = await fixture();
    const executable = path.join(f.root, "inspire-progress.cjs");
    await fs.writeFile(executable, `#!/usr/bin/env node\nconst args=process.argv.slice(2);console.log('Setting up connection...');if(args.includes('check'))console.log(JSON.stringify({success:true,data:{message:'quoted "} ]" values'}}));\n`, { mode: 0o700 });
    const service = new SiiExperimentService({ ...f.options, inspireBin: executable, runJson: undefined });
    services.push(service); await service.start(); await service.refreshNow();
    const binding = await service.bind({ ...f.request, invocationId: "inv_progress" }, new AbortController().signal); binding.session = session; binding.activate();
    expect(await binding.call("sii_command", { args: ["config", "check"] })).toMatchObject({ result: { success: true, data: { message: 'quoted "} ]" values' } } });
    expect(await binding.call("sii_command", { args: ["notebook", "connection", "refresh", "cpu-box"] })).toMatchObject({ result: { output: "Setting up connection...\n", exit_code: 0 } });
    const submission = await binding.call("sii_submit_experiment", { request_id: "unconfirmed", args: ["job", "create", "--name", "unconfirmed", "--workspace", "space", "--project", "具有能动性的科学大模型"] }) as { experiment: { status: string } };
    expect(submission.experiment.status).toBe("submission_unknown");
  });

  it("disables notebook CLI defaults that wait and refuses synchronous post-start actions before creating a resource", async () => {
    const f = await fixture();
    await f.submit("notebook", { required_for_task: false });
    expect(f.runJson.mock.calls.find(([args]) => args.includes("create"))?.[0].slice(-3)).toEqual(["--no-wait", "--post-start", "none"]);
    for (const flags of [["--post-start", "python train.py"], ["--post-start-script=/tmp/setup.sh"]]) {
      await expect(f.binding.call("sii_submit_experiment", { request_id: "post-start", required_for_task: false,
        args: ["notebook", "create", "--name", "post-start", "--workspace", "compute-space", "--project", "具有能动性的科学大模型", ...flags] })).rejects.toThrow("force CLI waiting");
    }
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
    expect((await f.service.document(f.request.projectPath)).experiments).toHaveLength(1);
  });

  it.each([ ["job", "job_succeeded"], ["hpc", "hpc_failed"] ])("keeps %s task unfinished without repair/polling turns and notifies its original session on %s", async (kind, state) => {
    const f = await fixture();
    const { experiment } = await f.submit(kind);
    const revalidate = vi.fn(async () => undefined);
    const controls = new ControlActionService({ projectId: PROJECT, agent: "execution", invocationId: "inv_first", stateVersion: 1, capability: "test-capability", stagingPath: path.join(f.request.runtimePath, "actions.json"), revalidate });
    await expect(controls.stage("test-capability", "premature-finish", { tool: "finish_task" })).rejects.toThrow("still needs experiment results");
    expect(revalidate).not.toHaveBeenCalled();
    await expect(fs.access(path.join(f.request.runtimePath, "actions.json"))).rejects.toThrow();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Inspect measured metrics and compare baseline." });
    let resolved = false;
    const waiting = f.binding.wait("Experiment pending, task unfinished.", vi.fn()).then(value => { resolved = true; return value; });
    await vi.waitFor(() => expect(f.onExperimentWait).toHaveBeenCalledWith(true));
    await expect(controls.stage("test-capability", "finish-while-system-waits", { tool: "finish_task" })).rejects.toThrow("still needs experiment results");
    expect(revalidate).not.toHaveBeenCalled();
    await expect(f.binding.call("sii_get_experiment", { experiment_id: experiment.id })).rejects.toThrow("active Agent turn");
    await f.service.refreshNow();
    expect(resolved).toBe(false);
    f.state(state); await f.due(); await f.service.refreshNow();
    const notification = await waiting;
    expect(notification).toContain(state.includes("failed") ? '"status":"failed"' : '"status":"succeeded"');
    expect(f.binding.session?.nativeId).toBe("original-thread");
    expect(f.onExperimentWait.mock.calls.map(args => args[0])).toEqual([true, false]);
    await receiveNotification(f.binding, notification!);
    await controls.stage("test-capability", "processed-finish", { tool: "finish_task" });
    expect(revalidate).toHaveBeenCalledOnce();
    expect(await f.binding.wait("Results processed.", vi.fn())).toBeUndefined();
    await f.binding.clearWait();
    const callCount = f.runJson.mock.calls.length;
    await f.service.refreshNow(); expect(f.runJson.mock.calls).toHaveLength(callCount);
  });

  it("recovers a deferred task after restart without re-submitting or replacing the session", async () => {
    const f = await fixture(); const { experiment } = await f.submit();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Continue original analysis." });
    const oldWait = f.binding.wait("Retained handoff.", vi.fn()).catch(error => error);
    await vi.waitFor(() => expect(f.onExperimentWait).toHaveBeenCalledWith(true));
    f.binding.close(); expect(await oldWait).toBeInstanceOf(Error); await f.service.stop();
    f.state("job_succeeded");
    const next = new SiiExperimentService(f.options); services.push(next); await next.start(); await next.refreshNow();
    const recovered = await next.bind({ ...f.request, invocationId: "inv_after_restart" }, new AbortController().signal);
    recovered.session = session;
    const notice = await recovered.wait(undefined, vi.fn());
    expect(notice).toContain("sii_get_task_context");
    expect(notice).not.toContain("Retained handoff.");
    expect(notice).not.toContain("Continue original analysis.");
    await recovered.beginResume(); recovered.activate();
    expect(await recovered.call("sii_get_task_context", { field: "context" })).toMatchObject({ content: "Continue original analysis.", nextPage: null });
    expect(await recovered.call("sii_get_task_context", { field: "handoff" })).toMatchObject({ content: "Retained handoff.", nextPage: null });
    const previous = await recovered.call("sii_submit_experiment", { args: ["job", "create", "--name", "training-a", "--workspace", "compute-space", "--project", "具有能动性的科学大模型", "--command", "python train.py"], request_id: "run-a" });
    expect(JSON.stringify(previous)).toContain(experiment.id);
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
    await recovered.clearWait();
  });

  it("preserves an ambiguous create and rejects changed input under the same id", async () => {
    const f = await fixture(); f.failCreate();
    const first = await f.submit(); expect(first.experiment.status).toBe("submission_unknown");
    await f.submit(); expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
    await expect(f.submit("hpc")).rejects.toThrow("different submission");
  });

  it("does not classify query failure as experiment failure or repeatedly wake for it", async () => {
    const f = await fixture(); const { experiment } = await f.submit();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Inspect when available." });
    f.failQueries();
    for (let i = 0; i < 3; i++) { await f.due(); await f.service.refreshNow(); }
    const notification = await f.binding.wait("Pending.", vi.fn());
    expect(notification).toContain("network unavailable"); expect(notification).toContain('"status":"queued"');
    await receiveNotification(f.binding, notification!);
    await expect(assertSiiControlAction(PROJECT, "execution", "inv_first", { tool: "finish_task" })).rejects.toThrow();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Continue system monitoring." });
    let resolved = false;
    const wait = f.binding.wait("Pending.", vi.fn()).then(() => { resolved = true; }).catch(() => undefined);
    await f.due(); await f.service.refreshNow(); expect(resolved).toBe(false);
    f.binding.close(); await wait;
  });

  it("requires this run's atomic completion marker rather than notebook RUNNING or an old marker", async () => {
    const f = await fixture(); const marker = path.join(f.request.workspacePath, "done.json");
    const { experiment } = await f.submit("notebook", { completion_file: marker });
    expect(experiment.runId).toBe("run-a");
    await fs.writeFile(marker, JSON.stringify({ run_id: "old-run", exit_code: 0 }));
    await f.service.refreshNow(); expect((await f.service.document(f.request.projectPath)).experiments[0]?.status).toBe("running");
    await fs.writeFile(marker, JSON.stringify({ run_id: "run-a", exit_code: 3 }));
    await f.due(); await f.service.refreshNow(); expect((await f.service.document(f.request.projectPath)).experiments[0]?.status).toBe("failed");
  });

  it("retains the original session when a restart attempts a replacement", async () => {
    const f = await fixture(); const { experiment } = await f.submit();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Keep my original session." });
    f.binding.session = { ...session, nativeId: "replacement-thread", generation: 1 };
    await expect(f.binding.wait(undefined, vi.fn())).rejects.toThrow("cannot be replaced");
    expect((await f.service.document(f.request.projectPath)).waits[0]?.session.nativeId).toBe("original-thread");
  });

  it("replays a ready notification if the server stops during the resumed model turn", async () => {
    const f = await fixture(); const { experiment } = await f.submit();
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Finish the original analysis." });
    f.state("job_succeeded"); await f.service.refreshNow();
    const notification = await f.binding.wait("Pending handoff.", vi.fn());
    expect(notification).toContain("sii_get_task_context");
    expect(notification).not.toContain("Finish the original analysis.");
    await f.binding.beginResume(); f.binding.activate();
    expect(await f.binding.call("sii_get_task_context", { field: "context" })).toMatchObject({ content: "Finish the original analysis.", nextPage: null });
    await receiveNotification(f.binding, notification!);
    expect((await f.service.document(f.request.projectPath)).experiments[0]!.acknowledged).toBe(true);
    f.binding.close(); await f.service.stop();
    const next = new SiiExperimentService(f.options); services.push(next); await next.start(); await next.refreshNow();
    const recovered = await next.bind({ ...f.request, invocationId: "inv_notification_recovery" }, new AbortController().signal); recovered.session = session;
    expect(await recovered.wait(undefined, vi.fn())).toContain("sii_get_task_context");
    await recovered.beginResume(); recovered.activate();
    expect(await recovered.call("sii_get_task_context", { field: "handoff" })).toMatchObject({ content: "Pending handoff.", nextPage: null });
    expect(recovered.session.nativeId).toBe(session.nativeId);
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
  });

  it("handles completion-before-deferral immediately and isolates task ownership", async () => {
    const f = await fixture(); const { experiment } = await f.submit();
    f.state("job_succeeded"); await f.service.refreshNow();
    await f.binding.call("sii_get_experiment", { experiment_id: experiment.id });
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "Process results." });
    expect(await f.binding.wait("Pending.", vi.fn())).toContain('"status":"succeeded"');
    const other = await f.service.bind({ ...f.request, taskSessionId: "other-task" }, new AbortController().signal); other.session = session; other.activate();
    await expect(other.call("sii_get_experiment", { experiment_id: experiment.id })).rejects.toThrow("does not belong");
  });

  it("monitors each batch item independently and supports literal create options", async () => {
    const f = await fixture();
    const args = ["job", "create", "--workspace", "compute-space", "--project", "具有能动性的科学大模型", "--shm-size", "32", "--enable-notification"];
    const result = await f.binding.call("sii_submit_batch", { experiments: [
      { args: [...args, "--name", "batch-a"], request_id: "batch-a" },
      { args: [...args, "--name", "batch-b"], request_id: "batch-b" }
    ] });
    expect(JSON.stringify(result)).toContain("batch-b");
    expect((await f.service.document(f.request.projectPath)).experiments).toHaveLength(2);
    expect(f.runJson.mock.calls.every(([args]) => args.includes("--shm-size") && args.includes("--enable-notification"))).toBe(true);
  });

  it("monitors multiple programs on the same existing notebook without recreating it or accepting old run markers", async () => {
    const f = await fixture(); const marker = path.join(f.request.workspacePath, "notebook-run.json");
    await fs.writeFile(marker, JSON.stringify({ run_id: "previous-program", exit_code: 0 }));
    const input = { kind: "notebook", name: "reused-notebook", workspace: "compute-space", request_id: "program-one", completion_file: marker };
    const first = await f.binding.call("sii_register_experiment", input) as { experiment: { id: string } };
    await f.binding.call("sii_register_experiment", input);
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(0);
    await f.service.refreshNow();
    expect((await f.service.document(f.request.projectPath)).experiments[0]!.status).toBe("running");
    await f.binding.call("sii_command", { args: ["notebook", "exec", "reused-notebook", "start-background-program"] });
    await fs.writeFile(marker, JSON.stringify({ run_id: "program-one", exit_code: 0 }));
    await f.due(); await f.service.refreshNow();
    await receiveResult(f.binding, await f.binding.call("sii_get_experiment", { experiment_id: first.experiment.id }));
    const second = await f.binding.call("sii_register_experiment", { ...input, request_id: "program-two" }) as { experiment: { id: string } };
    await f.due(); await f.service.refreshNow();
    expect((await f.service.document(f.request.projectPath)).experiments[1]!.status).toBe("running");
    await fs.writeFile(marker, JSON.stringify({ run_id: "program-two", exit_code: 5 }));
    await f.due(); await f.service.refreshNow();
    await receiveResult(f.binding, await f.binding.call("sii_get_experiment", { experiment_id: second.experiment.id }));
    await f.binding.assertTaskComplete();
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(0);
    const other = await f.service.bind({ ...f.request, taskSessionId: "another-task" }, new AbortController().signal); other.session = session; other.activate();
    await expect(other.call("sii_register_experiment", { ...input, request_id: "program-two" })).rejects.toThrow("fresh request_id");
    await fs.writeFile(marker, JSON.stringify({ run_id: "untracked-old-run", exit_code: 0 }));
    await expect(other.call("sii_register_experiment", { ...input, request_id: "untracked-old-run" })).rejects.toThrow("already contains this run_id");
  });

  it("wakes a resource-only notebook startup on readiness without declaring its scientific program completed", async () => {
    const f = await fixture();
    const { experiment } = await f.submit("notebook", { required_for_task: false });
    await f.binding.call("sii_defer_task", { experiment_ids: [experiment.id], context: "When the notebook is ready, register and start my actual experiment." });
    const wait = f.binding.wait("Waiting for resource startup.", vi.fn());
    await vi.waitFor(() => expect(f.onExperimentWait).toHaveBeenCalledWith(true));
    f.state("notebook_running"); await f.service.refreshNow();
    const notification = await wait;
    expect(notification).toContain('"status":"resource_ready"');
    expect(notification).toContain('"completion_scope":"resource_startup"');
    await f.binding.beginResume(); f.binding.activate();
    await f.binding.call("sii_register_experiment", { kind: "notebook", name: "training-a", workspace: "compute-space", request_id: "actual-program", completion_file: "actual-program.json" });
    await expect(f.binding.assertTaskComplete()).rejects.toThrow("still needs experiment results");
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
  });

  it("keeps GPU accounting compatible and rejects completion without explicit deferral", async () => {
    const f = await fixture();
    const args = ["job", "create", "--name", "accounted-run", "--workspace", "compute-space", "--project", "具有能动性的科学大模型", "--quota", "2,16,128", "--nodes", "3", "--group", "H100-group", "--command", "echo inspire job create --name fake --quota 99,16,128"];
    await f.binding.call("sii_submit_experiment", { args, request_id: "accounted-run" });
    const registry = new ProjectInspireWorkloadRegistry(f.options.projectsRoot);
    expect(await registry.list(PROJECT)).toEqual([expect.objectContaining({ name: "accounted-run", requestedGpuCount: 6, requestedAcceleratorType: "H100", invocationId: "inv_first" })]);
    await f.binding.call("sii_submit_experiment", { args, request_id: "accounted-run" });
    expect(await registry.list(PROJECT)).toHaveLength(1);
    await expect(f.binding.assertTaskComplete()).rejects.toThrow("still needs experiment results");
    await expect(f.submit("job", { args: [...args, "--account", "wrong-account"] })).rejects.toThrow("must match");
    expect(f.runJson.mock.calls.filter(([args]) => args.includes("create"))).toHaveLength(1);
  });

  it("does not permit required submission or deferral after a completion receipt", async () => {
    const f = await fixture();
    const stagingPath = path.join(f.request.runtimePath, "actions.json");
    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    await fs.writeFile(stagingPath, JSON.stringify([{ action: { tool: "finish_task" } }]));
    f.binding.activate({ ...f.request, control: { stagingPath } as AgentRunRequest["control"] });
    await expect(f.submit()).rejects.toThrow("already recorded task completion");
    expect(f.runJson).not.toHaveBeenCalled();
  });
});
