/** Run the unchanged original research tests with all fixture writes outside the checkout. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const tempRoot = option('--temp-root');
if (!tempRoot || !path.isAbsolute(tempRoot)) throw new Error('--temp-root must be an explicit absolute isolated directory');
await fs.mkdir(tempRoot, { recursive: true });
const fixture = await fs.mkdtemp(path.join(tempRoot, 'research-'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tests = ['scripts/example-workflows/raven-contract.test.mjs',
  'scripts/example-workflows/task-bridge.test.mjs'];
const sources = [...tests, 'scripts/example-workflows/task-bridge.cjs'];
const inputs = [];
for (const relative of sources) {
  const source = path.join(root, relative), target = path.join(fixture, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  const bytes = await fs.readFile(source), copy = await fs.readFile(target);
  if (!bytes.equals(copy)) throw new Error(`Fixture copy changed original source: ${relative}`);
  inputs.push({ path: relative, sha256: sha(bytes), fixtureCopySha256: sha(copy), exactCopy: true });
}
await fs.mkdir(path.join(fixture, 'sdk'));
// Borrow installed modules/build output by reference; original test files and
// test-created directories live in the fixture. Neither test writes to sdk/.
for (const [target, source] of [['node_modules', 'node_modules'], ['sdk/dist', 'sdk/dist']]) {
  await fs.symlink(path.join(root, source), path.join(fixture, target), process.platform === 'win32' ? 'junction' : 'dir');
}
await fs.copyFile(path.join(root, 'sdk/package.json'), path.join(fixture, 'sdk/package.json'));
for (const relative of ['sdk/dist/core/scoped-workflow-contract.js', 'sdk/dist/core/scoped-workflow-planner.js']) {
  inputs.push({ path: relative, sha256: sha(await fs.readFile(path.join(root, relative))), access: 'existing-built-module-read-only-use' });
}
const command = [process.execPath, '--test', '--test-reporter=tap', ...tests];
const started = new Date().toISOString();
const run = spawnSync(command[0], command.slice(1), { cwd: fixture, encoding: 'utf8', timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TEMP: tempRoot, TMP: tempRoot } });
const log = `${run.stdout ?? ''}${run.stderr ? `\nSTDERR:\n${run.stderr}` : ''}`;
const logPath = path.join(fixture, 'research-node-tests.log'); await fs.writeFile(logPath, log);
const metric = name => Number(run.stdout?.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? -1);
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, metric(name)]));
const report = { schemaVersion: 1, status: 'executed', startedAt: started, finishedAt: new Date().toISOString(),
  platform: process.platform, node: process.version, command, cwd: fixture, inputs,
  originalSourcesAndAssertionsModified: false, fixtureWritesOutsideCheckout: true,
  network: 'Original tests use loopback HTTP fixtures only; the Raven contract tests are pure local module calls.',
  modelCalls: 0, scientificJobsLaunched: 0, exitCode: run.status, signal: run.signal,
  error: run.error ? String(run.error) : null, counts,
  log: { path: logPath, sha256: sha(log), text: log },
  success: run.status === 0 && counts.tests === 11 && counts.pass === 11 &&
    ['fail', 'cancelled', 'skipped', 'todo'].every(name => counts[name] === 0) };
if (option('--report')) await fs.writeFile(path.resolve(option('--report')), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ success: report.success, counts, logPath, fixture }));
if (!report.success) process.exitCode = 1;
