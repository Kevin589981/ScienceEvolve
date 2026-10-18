import assert from "node:assert/strict";
import { access, appendFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMainWorkflowConfig, validateMainWorkflowConfig, bindMainWorkflowConfig } from "@scienceevolve/sdk/main";
import { createMainApplicationRuntime } from "@scienceevolve/sdk/application/main-runtime";

// Installed tarball only. Actual main kernel/SQLite, explicitly simulated Agents.
// This is packaging/regression evidence, never real-model or research acceptance.
const compiled = import.meta.resolve("@scienceevolve/sdk/application/main-runtime");
const { createMainSdkClient } = await import(new URL("./main-client.js", compiled));
const { harnessCatalogRegistry, toPublicHarnessDescriptor } = await import(new URL("./core/harness-runtime/registry.js", compiled));
const names = ["01-ahe-evolve", "02-software-development", "dynamic-research-workflow"];
const files = [...names.map(name => path.resolve("main-example-configs", name, "workflow.json")),
  ...["default-workflow.json", "existing-project/workflow.json", "workflow-reconfiguration/workflow.json"]
    .map(file => path.resolve("node_modules/@scienceevolve/sdk/examples", file))];
const configs = [];
for (const file of files) {
  const raw = JSON.parse(await readFile(file, "utf8"));
  const loaded = await loadMainWorkflowConfig(file);
  assert.deepEqual(validateMainWorkflowConfig(loaded), loaded);
  assert.equal(loaded.git.enabled, false);
  assert.equal(loaded.orchestration.schemaVersion, 2);
  assert.deepEqual(loaded.orchestration.collaborations, []);
  assert.ok(Object.values(raw.agents).every(agent => !("gatewaySource" in agent) && !("reasoningEffort" in agent)));
  const bound = bindMainWorkflowConfig(loaded, { harness: "codex", model: "fixture" });
  assert.deepEqual(bound.orchestration, loaded.orchestration);
  for (const [id, agent] of Object.entries(loaded.agents)) assert.deepEqual(bound.agents[id].skills, agent.skills);
  configs.push(bound);
}
const parallel = await loadMainWorkflowConfig(path.resolve("node_modules/@scienceevolve/sdk/examples/parallel-git-review/workflow.json"));
assert.equal(parallel.git.enabled, true);
assert.equal(parallel.orchestration.scopedWorkflow.groups[0].workflow.input.edges.length, 2);
function action(request, value) {
  return { handoff: "Deterministic package fixture evidence", controlActions: [{ projectId: request.project.id, agent: request.agent,
    invocationId: request.invocationId, callId: `${request.invocationId}-action`, stateVersion: request.control.stateVersion,
    capabilityHash: request.control.capabilityHash, receivedAt: new Date().toISOString(), action: value }] };
}
const complete = request => action(request, { tool: "complete_project", rationale: "Fixture evidence accepted" });
async function open(dataDir, run) {
  const runtime = await createMainApplicationRuntime({ dataDir,
    gatewayOptions: { fetch: async () => { throw new Error("No network in package example fixture"); } },
    internal: { runner: { run, harnessCatalog: async () => harnessCatalogRegistry.list().map(entry => toPublicHarnessDescriptor(entry, { available: true })) },
      residentLauncher: { open: async () => { throw new Error("Git-off must not open resident"); } } } });
  const sdk = await createMainSdkClient(runtime);
  return { sdk, runtime };
}
const results = [];
for (const [index, name] of names.entries()) {
  const workspace = path.resolve(`main-example-workspace-${name}`), dataDir = path.resolve(`main-example-data-${name}`);
  await mkdir(workspace);
  const canonical = await realpath(workspace), calls = [];
  await writeFile(path.join(workspace, "original.txt"), "caller-owned source");
  let decisions = 0, tests = 0;
  const { sdk, runtime } = await open(dataDir, async request => {
    assert.equal(request.workspacePath, canonical);
    assert.equal(await readFile(path.join(request.workspacePath, "original.txt"), "utf8"), "caller-owned source");
    calls.push(request.agent);
    await appendFile(path.join(workspace, "trace.jsonl"), JSON.stringify({ agent: request.agent,
      total: request.project.loopTotalIterations, batches: request.project.loopBatches }) + "\n");
    if (name === "01-ahe-evolve") {
      if (request.agent !== "main") return { handoff: "Recorded round evidence" };
      assert.equal(request.project.pendingMainDecision?.reason, "loop-limit");
      return ++decisions === 1 ? action(request, { tool: "route_to_agent", target: "optimizer", assignment: "Second batch" }) : complete(request);
    }
    if (name === "02-software-development") {
      assert.notEqual(request.agent, "main");
      if (request.agent === "coding") {
        await writeFile(path.join(workspace, "implementation.json"), JSON.stringify({ value: tests ? 2 : 1 }));
        return { handoff: "Implementation ready for fixture testing" };
      }
      const value = JSON.parse(await readFile(path.join(workspace, "implementation.json"), "utf8")).value;
      await writeFile(path.join(workspace, `test-${++tests}.json`), JSON.stringify({ passed: value === 2 }));
      if (value !== 2) return { handoff: "Fixture test failed: repair output to equal 2" };
      assert.equal(request.control?.canComplete, true);
      return complete(request);
    }
    if (request.agent !== "main") return { handoff: "Recorded research-stage fixture evidence" };
    const target = ["execution", "writing", "review"][decisions++];
    if (!target) {
      assert.equal(request.project.pendingMainDecision?.sourceAgent, "review");
      assert.ok(request.project.pendingMainDecision.candidateAgents.includes("finish"));
    }
    if (!target && request.control?.canComplete) return complete(request);
    return action(request, { tool: "route_to_agent", target: target ?? "finish", assignment: target ? "Next research stage" : "Review accepted" });
  });
  let id, trace;
  try {
    const gateway = await sdk.gateways.add({ name: "Package example fixture", url: "https://93.184.216.34/v1", apiKey: "fixture-only",
      models: ["fixture"], defaultModel: "fixture", protocol: "responses",
      modelReasoning: { fixture: { parameter: "reasoning.effort", options: [{ id: "high", label: "High", value: "high" }] } } });
    const run = await sdk.start({ title: name, requirement: "Run deterministic installed-package regression fixture", workflow: configs[index],
      workspace, gatewayBindings: { defaultGatewayId: gateway.id } });
    id = run.id;
    const result = await run.wait({ signal: AbortSignal.timeout(12_000) });
    assert.equal(result.status, "completed", JSON.stringify({ lastError: result.lastError, calls }));
    if (name === "01-ahe-evolve") {
      assert.equal(result.loopBatches.code_evolution, 2);
      assert.equal(result.loopTotalIterations.code_evolution, 6);
      const batch = Array.from({ length: 3 }, () => ["optimizer", "execute", "judge"]).flat();
      assert.deepEqual(calls, ["execute", "judge", ...batch, "main", ...batch, "main"]);
    } else if (name === "02-software-development") {
      assert.deepEqual(calls, ["coding", "testing", "coding", "testing"]);
      assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "test-1.json"), "utf8")), { passed: false });
      assert.deepEqual(JSON.parse(await readFile(path.join(workspace, "test-2.json"), "utf8")), { passed: true });
      assert.equal((await runtime.storage.readEvents(id)).find(event => event.type === "project.completed")?.agent, "testing");
    } else assert.deepEqual(calls, ["idea", "main", "execution", "main", "writing", "main", "review", "main", "main"]);
    trace = await readFile(path.join(workspace, "trace.jsonl"), "utf8");
    assert.equal(trace.trim().split("\n").length, calls.length);
    await assert.rejects(access(path.join(workspace, ".git")), { code: "ENOENT" });
  } finally { await sdk.close(); }
  let replayed = 0;
  const reopened = await open(dataDir, async () => { replayed++; throw new Error("Completed example must not replay"); });
  try {
    assert.equal((await (await reopened.sdk.getRun(id)).wait({ signal: AbortSignal.timeout(3_000) })).status, "completed");
    assert.equal(await reopened.runtime.storage.roleWorkspace(id, "main", "inv_reopen"), canonical);
    assert.equal(await readFile(path.join(workspace, "trace.jsonl"), "utf8"), trace);
    assert.equal(replayed, 0);
  } finally { await reopened.sdk.close(); }
  results.push({ name, calls: calls.length, reopenedWithoutReplay: true });
}
console.log(JSON.stringify({ compiledMainExamples: true, configsValidated: configs.length, results,
  actualSqlite: true, externalWorkspace: true, simulatedAgents: true, realModel: false, network: false }));
