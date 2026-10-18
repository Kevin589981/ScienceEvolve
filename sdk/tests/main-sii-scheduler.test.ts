import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { AgentInterruptedError } from "../src/core/codex-runner.js";
import { EventHub } from "../src/core/event-hub.js";
import { Orchestrator } from "../src/core/orchestrator.js";
import { SkillCatalog } from "../src/core/skill-catalog.js";
import { ProjectStorage } from "../src/core/storage.js";
import { harnessCatalogRegistry, toPublicHarnessDescriptor } from "../src/core/harness-runtime/registry.js";
import type { AgentRunRequest, AgentRunResult, AgentRunner, TraceSink } from "../src/core/types.js";

class RetainedTaskRunner implements AgentRunner {
  readonly requests = new Map<string, AgentRunRequest>();
  readonly starts: string[] = [];
  async harnessCatalog() { return harnessCatalogRegistry.list().map(descriptor => toPublicHarnessDescriptor(descriptor, { available: true })); }
  async run(request: AgentRunRequest, _trace: TraceSink, signal: AbortSignal): Promise<AgentRunResult> {
    this.requests.set(request.project.id, request); this.starts.push(request.project.id);
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new AgentInterruptedError("fixture cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}

it("releases experiment waiting capacity and fairly reacquires it for the original unfinished invocation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sdk-sii-scheduler-"));
  const storage = new ProjectStorage(root, new EventHub());
  const runner = new RetainedTaskRunner();
  const skills = new SkillCatalog([fileURLToPath(new URL("../../.agents/skills", import.meta.url))]);
  const orchestrator = new Orchestrator(storage, skills, runner, { agentConcurrency: 1 });
  const ids: string[] = [];
  const input = (title: string) => ({ title, requirement: "Verify fair scheduling while an experiment is unfinished.",
    agents: Object.fromEntries(["main", "idea", "execution", "writing", "review"].map(agent => [agent, { model: "test-model", skills: [] }])) });
  try {
    await orchestrator.initialize();
    const a = await orchestrator.createProject(input("Pending experiment")); ids.push(a.id);
    await vi.waitFor(() => expect(runner.requests.has(a.id)).toBe(true), { timeout: 5000 });
    const b = await orchestrator.createProject(input("Independent task")); ids.push(b.id);
    await vi.waitFor(() => expect(orchestrator.getQueueSnapshot().worker.queued.some(item => item.projectId === b.id)).toBe(true));
    const original = runner.requests.get(a.id)!;
    await original.onExperimentWait!(true);
    await vi.waitFor(() => expect(runner.requests.has(b.id)).toBe(true));
    expect(await orchestrator.getProject(a.id)).toMatchObject({ status: "running", phase: "idea:awaiting-experiment-result",
      currentAgent: "idea", activeInvocationId: original.invocationId });
    expect(orchestrator.getQueueSnapshot().worker.activeProjectIds).toEqual([b.id]);
    const continuation = original.onExperimentWait!(false);
    void continuation.catch(() => {});
    await vi.waitFor(() => expect(orchestrator.getQueueSnapshot().worker.queued.some(item => item.projectId === a.id)).toBe(true));
    expect(runner.starts.filter(id => id === a.id)).toHaveLength(1);
    await orchestrator.cancel(b.id); await continuation;
    expect(orchestrator.getQueueSnapshot().worker.activeProjectIds).toEqual([a.id]);
    expect(await orchestrator.getProject(a.id)).toMatchObject({ status: "running", phase: "idea:running", activeInvocationId: original.invocationId });
    expect((await storage.readEvents(a.id)).map(event => event.type)).toEqual(expect.arrayContaining(["agent.experiment.waiting", "agent.experiment.resumed"]));
  } finally {
    await Promise.all(ids.map(id => orchestrator.cancel(id)));
    await Promise.all(ids.map(id => orchestrator.waitForIdle(id)));
    await orchestrator.shutdown();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
  expect(orchestrator.getQueueSnapshot().worker.activeProjectIds).toEqual([]);
}, 15000);
