// Opt-in real acceptance. This calls paid models and (with --git) creates a
// dedicated private GitHub repository. Keys are environment-only inputs;
// private SDK runtime data stores the Gateway key and must not be committed.
import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearchSdk, validateWorkflowConfig, loadWorkflowConfig } from '../dist/index.js';
import { configureAcceptanceReadRetries } from './acceptance-network.mjs';

configureAcceptanceReadRetries();

const root = path.resolve(process.env.SDK_ACCEPTANCE_ROOT ?? 'D:/openfars/sdk-acceptance-workspace-20261006-real');
const key = process.env.MODEL_API_KEY;
if (!key) throw new Error('MODEL_API_KEY is required');
const model = process.env.SDK_ACCEPTANCE_MODEL ?? 'gpt-6-luna';
const url = process.env.SDK_ACCEPTANCE_BASE_URL ?? 'https://fnlp.mosshub.cn/v1';
const gitMode = process.argv.includes('--git');
const harnesses = {};
const installation = process.env.SDK_ACCEPTANCE_HARNESSES;
if (installation) {
  for (const [id, file] of Object.entries({ dsh: 'node_modules/@deepseek-ai/dsh/lib/bin.js' })) {
    const candidate = path.join(installation, file);
    try { await fs.access(candidate); harnesses[id] = candidate; } catch {}
  }
}
await fs.mkdir(root, { recursive: true });
const dataDir = path.join(root, gitMode ? 'git-runtime' : 'matrix-runtime');
const options = { dataDir, harnesses, execution: { retryBaseMs: 1000, retryMaxMs: 1000 },
  timeouts: { protocolProxyTimeoutMs: 120000, residentModelInactivityTimeoutMs: 180000 },
  git: { credentialResolver: async signal => {
    signal?.throwIfAborted();
    const token = execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
    return { token, requestedScopes: ['repo'] };
  } } };
const sdk = await createResearchSdk(options);
const redact = text => String(text).replaceAll(key, '[REDACTED]');
const log = entry => process.stdout.write(JSON.stringify(entry) + '\n');
const report = { platform: process.platform, node: process.version, model, sourceCommit: sdk.sourceCommit,
  runtimeRevision: sdk.runtimeRevision, realModel: true, realGitHub: gitMode, startedAt: new Date().toISOString(), probes: [], runs: [] };
let run;
try {
  const gateway = (await sdk.gateways.list())[0] ?? await sdk.gateways.add({ name: 'Isolated workspace acceptance', url, apiKey: key,
    protocol: 'chat-completions', models: [model], defaultModel: model });
  const catalog = await sdk.harnesses();
  const selections = process.env.SDK_ACCEPTANCE_ONLY?.split(',') ?? (gitMode ? ['codex'] : ['codex', 'pi', 'dsh']);
  for (const harness of selections) {
    if (!catalog.find(item => item.id === harness)?.available) { report.probes.push({ harness, status: 'unavailable' }); log(report.probes.at(-1)); continue; }
    log({ type: 'probe.started', harness });
    try {
      const probeResult = await sdk.gateways.test(gateway.id, harness, model, {
        signal: AbortSignal.timeout(240000), onStage: stage => log({ type: 'probe.stage', harness, stage: stage.stage, status: stage.status, durationMs: stage.durationMs, error: stage.error })
      });
      report.probes.push({ harness, result: probeResult }); await fs.writeFile(path.join(root, gitMode ? 'git-report.json' : 'matrix-report.json'), JSON.stringify(report, null, 2));
      if (probeResult.status !== 'passed') { log({ type: 'probe.failed', harness, error: probeResult.error }); continue; }
      const workspace = path.join(root, gitMode ? 'git-original-project' : `original-${harness}`);
      await fs.mkdir(workspace); await fs.writeFile(path.join(workspace, 'seed.txt'), 'existing source sentinel\n');
      await fs.writeFile(path.join(workspace, 'workflow.json'), 'USER_ORIGINAL_WORKFLOW_DO_NOT_OVERWRITE\n');
      let workflow;
      if (gitMode) {
        workflow = await loadWorkflowConfig(fileURLToPath(new URL('../examples/main-runtime/workflow.json', import.meta.url)));
        workflow.git.repositoryName = process.env.SDK_ACCEPTANCE_REPOSITORY ?? `scienceevolve-sdk-workspace-20261006-${Date.now().toString(36)}`;
        for (const agent of Object.values(workflow.agents)) { agent.model = model; agent.harness = harness; agent.webSearch = false; }
        workflow.agents.execution.instructions = 'Read seed.txt from the imported existing project. Implement sum.py with add(a,b) returning a+b and test_sum.py with three Python unittest methods covering positive, negative and zero. Write acceptance.md citing seed.txt and honestly saying host tests are pending. Do not change seed.txt or workflow.json. Use authorized file/Git/control tools; create your business commit and PR, integrate to the group using the prescribed tools, then finish_task. Do not claim to have run a shell test if shell is unavailable.';
        workflow.agents.review.instructions = 'Independently inspect sum.py and test_sum.py. Write audit.md stating three cases and any defects; distinguish static audit from host runtime tests. Use the authorized Git tools to commit/PR/integrate your audit, then finish_task. Do not alter seed.txt or workflow.json.';
        workflow.agents.main.instructions = 'Lead the configured implementation/audit workflow to formal completion. Delegate business work, inspect delivery, integrate final group PR and verify finish facts. Do not claim runtime tests that were not performed. Use official controls, never handwrite tool results.';
      } else {
        workflow = validateWorkflowConfig({ git: { enabled: false }, agents: { main: { harness, model, permission: 'yolo', proxy: { mode: 'inherit' }, skills: [], autoSkills: [], mcpServers: [], webSearch: false,
          instructions: 'Read seed.txt, write result.txt containing exactly REAL_WORKSPACE_ACCEPTED and a newline, then formally call complete_project. Do not publish artifacts or change workflow.json. Use available real file tools. Do not claim completion without the file.' } },
          orchestration: { schemaVersion: 2, collaborations: [], agents: [{ name: 'main', template: 'main' }], input: { source: 'input', target: 'main' }, routes: { main: [] }, decisionPlans: {},
            allowMainReconfiguration: false, allowUserIntervention: false, termination: { agent: 'main', condition: 'result.txt exists with the exact sentinel and workflow.json is unchanged', automatic: false, decisionBy: 'main' } } });
      }
      run = await sdk.start({ title: `Windows real ${gitMode ? 'Git delivery' : 'in-place'} ${harness}`, requirement: gitMode ? 'Complete the three-Agent existing-project implementation and audit. Final integrated artifacts must automatically be delivered to the original workspace, keeping the original seed/config files unchanged.' : 'Create result.txt in the existing workspace, then formally complete. Preserve original files.',
        workflow, workspace, gatewayBindings: { defaultGatewayId: gateway.id } });
      log({ type: 'run.started', harness, runId: run.id, git: gitMode });
      const events = run.events()[Symbol.asyncIterator]();
      const consumer = (async () => { for await (const event of { [Symbol.asyncIterator]: () => events }) {
        await fs.appendFile(path.join(root, `${gitMode ? 'git' : harness}-events.jsonl`), JSON.stringify(event) + '\n');
        if (event.type !== 'agent.trace' && !event.type.startsWith('assistant.')) log({ type: 'run.event', harness, runId: run.id, event: event.type, sourceType: event.data?.sourceType, message: event.message?.slice(0, 220) });
      } })().catch(error => log({ type: 'events.stopped', harness, message: redact(error.message) }));
      const result = await run.wait({ signal: AbortSignal.timeout(gitMode ? 900000 : 240000) });
      await consumer;
      const originalConfig = await fs.readFile(path.join(workspace, 'workflow.json'), 'utf8');
      if (originalConfig !== 'USER_ORIGINAL_WORKFLOW_DO_NOT_OVERWRITE\n') throw new Error('Original workflow.json changed');
      if (await fs.readFile(path.join(workspace, 'seed.txt'), 'utf8') !== 'existing source sentinel\n') throw new Error('Original seed.txt changed');
      if (result.status !== 'completed') throw new Error(`Run stopped ${result.status}: ${result.lastError ?? result.phase}`);
      let hostTest;
      if (gitMode) {
        if (result.workspaceDelivery?.status !== 'synced') throw new Error('Integrated result was not automatically delivered');
        const tests = spawnSync('python', ['-m', 'unittest', '-v'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000 });
        const testOutput = String(tests.stdout ?? '') + String(tests.stderr ?? '');
        if (tests.error || tests.status !== 0 || !/Ran 3 tests/.test(testOutput) || !/\bOK\b/.test(testOutput)) throw new Error('Host did not execute exactly three passing tests');
        const independent = spawnSync('python', ['-c', 'from sum import add; assert add(2,3)==5; assert add(-2,-3)==-5; assert add(0,0)==0; print("HOST_INDEPENDENT_CASES_PASSED")'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000 });
        if (independent.error || independent.status !== 0 || !independent.stdout?.includes('HOST_INDEPENDENT_CASES_PASSED')) throw new Error('Independent host assertions failed');
        hostTest = { exitCode: tests.status, tests: 3, output: testOutput, independentCases: 3, independentOutput: independent.stdout };
        for (const file of ['sum.py', 'test_sum.py', 'acceptance.md', 'audit.md']) await fs.access(path.join(workspace, file));
      } else if ((await fs.readFile(path.join(workspace, 'result.txt'), 'utf8')).trim() !== 'REAL_WORKSPACE_ACCEPTED') throw new Error('Missing real workspace result');
      report.runs.push({ harness, runId: run.id, status: result.status, workspaceDelivery: result.workspaceDelivery, configPreserved: true, hostTest });
      log({ type: 'run.accepted', ...report.runs.at(-1) }); run = undefined;
    } catch (error) {
      const failed = run ? await run.snapshot().catch(() => undefined) : undefined;
      if (run && failed?.status === 'running') await run.cancel().catch(() => {});
      report.runs.push({ harness, ...(failed ? { runId: run.id, status: failed.status, phase: failed.phase,
        lastError: failed.lastError, failureAttempts: failed.failureAttempts } : {}), error: redact(error.message) });
      log({ type: 'acceptance.failed', harness, runId: run?.id, message: redact(error.message) }); run = undefined;
    }
  }
} finally {
  await sdk.close(); report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(root, gitMode ? 'git-report.json' : 'matrix-report.json'), JSON.stringify(report, null, 2));
}
log({ type: 'acceptance.finished', root, git: gitMode, probes: report.probes.map(p => ({ harness: p.harness, status: p.status ?? p.result?.status })), runs: report.runs });
