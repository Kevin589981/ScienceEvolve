import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  prompt: { type: 'string', short: 'p' }, 'prompt-file': { type: 'string' },
  model: { type: 'string', default: 'DeepSeek-V4.1-Flash-1017' },
  'context-window': { type: 'string', default: '131072' },
  'transport-test': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
} });
if (values.help) {
  console.log('scienceevolve-bench [-p PROMPT | --prompt-file FILE] [--model ID] [--context-window N]');
  process.exit(0);
}
if (values['transport-test']) {
  await import('./transport-test.mjs');
  process.exit(0);
}
if (values.prompt !== undefined && values['prompt-file'] !== undefined) throw new Error('Choose prompt text or a prompt file');
const prompt = values.prompt ?? await readFile(values['prompt-file'] || 'instruction.md', 'utf8');
const output = path.resolve('outputs');
await mkdir(output, { recursive: true });
const dataDir = '/tmp/scienceevolve-main-data';
const { createResearchSdk, loadWorkflowConfig, bindWorkflowConfig } = await import('./vendor/sdk/dist/index.js');
const loaded = await loadWorkflowConfig(path.join(root, 'workflow.json'));
const workflow = bindWorkflowConfig(loaded, { model: values.model, harness: 'pi' });
const rules = '\n\nScience Bench integration: The task is in /workspace/instruction.md. '
  + 'Read scientific materials and existing tests in /workspace. Edit scientific implementation only under source/. '
  + 'Run available public reproduction/tests; do not alter trusted tests, fixtures, instructions, task declarations, or grading criteria. '
  + 'Do not edit generated Cython C/C++ or binary build products as the repair. '
  + 'Keep development evidence in outputs/development/ and handoff notes in outputs/Memory.md. '
  + 'Only source changes will be replayed onto a clean baseline for grading. '
  + 'All tools are offline; the model is provided through the official exam relay. '
  + 'Do not request user clarification during this unattended evaluation: make reasonable assumptions and continue. '
  + 'Use real test evidence; a missing dependency or interrupted test is not a pass. '
  + 'If a scientific step is costly, save its output to outputs/ and inspect selected portions.';
for (const agent of Object.values(workflow.agents)) {
  agent.instructions += rules;
  agent.instructions = agent.instructions.replaceAll('development/', 'outputs/development/').replaceAll('outputs/outputs/', 'outputs/');
  agent.instructions = agent.instructions.replaceAll('Memory.md', 'outputs/Memory.md').replaceAll('outputs/outputs/', 'outputs/');
  agent.webSearch = false;
}
const sdk = await createResearchSdk({ dataDir,
  harnesses: { pi: path.join(root, 'pi-entry.py') },
  timeouts: { gatewayProbeTimeoutMs: 5_400_000, protocolProxyTimeoutMs: 5_400_000, residentModelInactivityTimeoutMs: 5_400_000,
    residentToolInactivityTimeoutMs: 5_400_000 } });
try {
  const gateway = await sdk.gateways.add({ name: 'Science Bench fixed Unix relay',
    url: 'https://10.255.255.1/v1', apiKey: 'exam-socket-placeholder-not-a-provider-key',
    protocol: 'chat-completions', models: [values.model], defaultModel: values.model,
    modelContextWindows: { [values.model]: Number(values['context-window']) },
    modelReasoning: { [values.model]: { parameter: 'reasoning_effort',
      options: [{ id: 'high', label: 'High', value: 'high' }] } } });
  console.log(JSON.stringify({ event: 'scienceevolve_gateway_probe_started' }));
  const probeStarted = performance.now();
  const probe = await sdk.gateways.test(gateway.id, 'pi', values.model, { reasoningOptionId: 'high',
    onStage: stage => console.log(JSON.stringify({ event: 'scienceevolve_gateway_stage',
      stage: stage.stage ?? stage.id ?? stage.name, status: stage.status,
      elapsed_seconds: (performance.now() - probeStarted) / 1000 })) });
  await writeFile(path.join(output, 'scienceevolve-gateway-probe.json'), JSON.stringify(probe, null, 2) + '\n');
  if (probe.status !== 'passed') throw new Error('ScienceEvolve gateway/adapter readiness failed: ' + (probe.error || 'unknown'));
  console.log(JSON.stringify({ event: 'scienceevolve_gateway_probe_passed',
    elapsed_seconds: (performance.now() - probeStarted) / 1000 }));
  const run = await sdk.start({ title: 'Science Bench scientific software repair', workflow,
    requirement: prompt + rules, workspace: path.resolve('.'),
    gatewayBindings: { defaultGatewayId: gateway.id } });
  console.log(JSON.stringify({ event: 'scienceevolve_started', runId: run.id, upstreamWorkflow: '02-software-development' }));
  const timer = setInterval(async () => {
    try { await writeFile(path.join(output, 'scienceevolve-state.json'), JSON.stringify(await run.snapshot(), null, 2) + '\n'); }
    catch (error) { console.error('Snapshot:', error.message); }
  }, 1000);
  try {
    for await (const event of run.events()) console.log(JSON.stringify(event));
    const result = await run.wait();
    await writeFile(path.join(output, 'scienceevolve-result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ event: 'scienceevolve_finished', status: result.status }));
    if (result.status !== 'completed') process.exitCode = 2;
  } finally { clearInterval(timer); }
} finally { await sdk.close(); }
