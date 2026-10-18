// Opt-in retry of a dedicated private Git acceptance run, never a live project.
import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createResearchSdk } from '../dist/index.js';
import { configureAcceptanceReadRetries } from './acceptance-network.mjs';

configureAcceptanceReadRetries();

const root = process.env.SDK_ACCEPTANCE_ROOT, id = process.env.SDK_ACCEPTANCE_RUN;
if (!root || !path.isAbsolute(root) || !/^prj_[a-f0-9]{32}$/.test(id ?? '')) throw new Error('Explicit acceptance root and run ID are required');
if (!path.basename(root).startsWith('sdk-acceptance-workspace-')) throw new Error('Only dedicated workspace acceptance directories are supported');
const sdk = await createResearchSdk({ dataDir: path.join(root, 'git-runtime'), git: {
  credentialResolver: async signal => {
    signal?.throwIfAborted();
    return { token: execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim(), requestedScopes: ['repo'] };
  }
}, timeouts: { protocolProxyTimeoutMs: 120000, residentModelInactivityTimeoutMs: 180000 },
execution: { retryBaseMs: 1000, retryMaxMs: 1000 } });
const log = data => process.stdout.write(JSON.stringify(data) + '\n');
async function saveReceipt(receipt) {
  await fs.appendFile(path.join(root, 'git-retry-attempts.jsonl'), JSON.stringify(receipt) + '\n');
  await fs.writeFile(path.join(root, 'git-retry-report.json'), JSON.stringify(receipt, null, 2));
}
const run = await sdk.getRun(id);
try {
  const previous = await run.snapshot();
  log({ type: 'resume.started', runId: id, previous: previous.status, phase: previous.phase });
  if (previous.userIntervention?.status === 'pending') {
    const message = process.env.SDK_ACCEPTANCE_RECOVERY_MESSAGE;
    if (!message) throw new Error('An explicit operator recovery message is required for a pending question');
    await run.respond(message);
  } else if (previous.status === 'paused' || previous.status === 'stopped') await run.resume();
  else if (!['completed', 'running', 'queued'].includes(previous.status)) throw new Error(`Cannot retry terminal state ${previous.status}`);
  const consumer = (async () => { for await (const event of run.events()) {
    await fs.appendFile(path.join(root, 'git-retry-events.jsonl'), JSON.stringify(event) + '\n');
    if (!['agent.trace', 'workflow.node.updated'].includes(event.type)) log({ type: event.type, sourceType: event.data?.sourceType });
  } })().catch(error => log({ type: 'events.stopped', message: String(error.message).slice(0, 500) }));
  const result = await run.wait({ signal: AbortSignal.timeout(900000) });
  await consumer;
  if (result.status !== 'completed' || result.workspaceDelivery?.status !== 'synced') throw new Error(`Retry did not complete/deliver: ${result.status} ${result.lastError ?? result.phase}`);
  const workspace = path.join(root, 'git-original-project');
  for (const file of ['sum.py', 'test_sum.py', 'acceptance.md', 'audit.md']) await fs.access(path.join(workspace, file));
  if (await fs.readFile(path.join(workspace, 'workflow.json'), 'utf8') !== 'USER_ORIGINAL_WORKFLOW_DO_NOT_OVERWRITE\n') throw new Error('Original configuration changed');
  if (await fs.readFile(path.join(workspace, 'seed.txt'), 'utf8') !== 'existing source sentinel\n') throw new Error('Original seed.txt changed');
  const tests = spawnSync('python', ['-m', 'unittest', '-v'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const testOutput = String(tests.stdout ?? '') + String(tests.stderr ?? '');
  if (tests.error || tests.status !== 0 || !/Ran 3 tests/.test(testOutput) || !/\bOK\b/.test(testOutput)) throw new Error('Host did not execute exactly three passing tests');
  const independent = spawnSync('python', ['-c', 'from sum import add; assert add(2,3)==5; assert add(-2,-3)==-5; assert add(0,0)==0; print("HOST_INDEPENDENT_CASES_PASSED")'], { cwd: workspace, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (independent.error || independent.status !== 0 || !independent.stdout?.includes('HOST_INDEPENDENT_CASES_PASSED')) throw new Error('Independent host assertions failed');
  const hostTest = { exitCode: tests.status, tests: 3, output: testOutput, independentCases: 3, independentOutput: independent.stdout };
  const receipt = { runId: id, runtimeRevision: sdk.runtimeRevision, realModel: true, realGitHub: true,
    status: result.status, workspaceDelivery: result.workspaceDelivery, configPreserved: true, hostTest, finishedAt: new Date().toISOString() };
  await saveReceipt(receipt);
  log({ type: 'resume.accepted', ...receipt });
} catch (error) {
  const failed = await run.snapshot().catch(() => undefined);
  const receipt = { runId: id, runtimeRevision: sdk.runtimeRevision, realModel: true, realGitHub: true,
    status: failed?.status, phase: failed?.phase, lastError: failed?.lastError,
    error: String(error.message).replace(/(?:sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]+)/g, '[REDACTED]'), finishedAt: new Date().toISOString() };
  await saveReceipt(receipt);
  log({ type: 'resume.failed', ...receipt });
  throw error;
} finally { await sdk.close(); }
