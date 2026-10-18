import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = { name: 'get_state', description: 'read', mode: 'read', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const write = { name: 'submit_training', description: 'write', mode: 'write', inputSchema: { type: 'object', properties: { requestId: { type: 'string', minLength: 1 }, expectedRevision: { type: 'integer', minimum: 0 } }, required: ['requestId', 'expectedRevision'], additionalProperties: false } };
const artifact = { ...read, name: 'read_artifact' };
async function setup(t, handler, useEndpoint = true) {
  const dir = await fs.mkdtemp(path.join(here, 'bridge-fixture-'));
  await fs.copyFile(path.join(here, 'task-bridge.cjs'), path.join(dir, 'task-bridge.cjs'));
  await fs.writeFile(path.join(dir, 'tools.json'), JSON.stringify({ method: 'fixture', actor: 'actor', tools: [read, write, artifact] }));
  let requests = 0;
  const server = http.createServer(async (req, res) => {
    requests++;
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    await handler(request, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(dir, 'task-bridge.cjs')], cwd: dir,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SCIENCEEVOLVE_TASK_'))), SCIENCEEVOLVE_TASK_SCOPE_ID: 'fixture-scope', ...(useEndpoint ? { SCIENCEEVOLVE_TASK_BACKEND_URL: `http://127.0.0.1:${server.address().port}/atomic` } : {}) }, stderr: 'pipe' });
  const client = new Client({ name: 'bridge-transport-test', version: '1' });
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); await fs.unlink(path.join(dir, 'task-bridge.cjs')); await fs.unlink(path.join(dir, 'tools.json')); await fs.rmdir(dir); });
  await client.connect(transport);
  return { client, count: () => requests };
}
function receipt(request, overrides = {}) { return { schemaVersion: 1, method: request.method, scopeId: request.scopeId, operation: request.operation, requestId: request.requestId, status: 'ok', data: {}, evidence: [{ id: 'durable-1', uri: 'fixture://receipt', kind: 'fixture-only', sha256: 'a'.repeat(64) }], ...overrides }; }
function send(res, result) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result)); }
const mutate = client => client.callTool({ name: 'submit_training', arguments: { requestId: 'stable-request-1', expectedRevision: 0 } });

test('missing backend blocks without making a network request', async t => {
  const s = await setup(t, () => assert.fail('must not call'), false);
  const result = await s.client.callTool({ name: 'get_state', arguments: {} });
  assert.equal(result.isError, true); assert.equal(JSON.parse(result.content[0].text).status, 'blocked'); assert.equal(s.count(), 0);
});
test('role tools and input schema reject unknown operation/extra fields before HTTP', async t => {
  const s = await setup(t, () => assert.fail('must not call'));
  assert.deepEqual((await s.client.listTools()).tools.map(tool => tool.name), ['get_state', 'submit_training', 'read_artifact']);
  await assert.rejects(s.client.callTool({ name: 'run_entire_system', arguments: {} }));
  const result = await s.client.callTool({ name: 'get_state', arguments: { extra: true } });
  assert.equal(result.isError, true); assert.equal(s.count(), 0);
});
test('successful mutation retains exact scope, actor and stable idempotence request', async t => {
  const s = await setup(t, (req, res) => { assert.equal(req.actor, 'actor'); assert.equal(req.scopeId, 'fixture-scope'); assert.equal(req.requestId, 'stable-request-1'); assert.equal(req.arguments.expectedRevision, 0); send(res, receipt(req)); });
  assert.equal((await mutate(s.client)).isError, false); assert.equal(s.count(), 1);
});
test('transport disconnect yields unknown and does not retry a mutation', async t => {
  const s = await setup(t, (_req, res) => res.destroy());
  const result = await mutate(s.client);
  assert.equal(result.isError, true); assert.equal(JSON.parse(result.content[0].text).status, 'outcome_unknown'); assert.equal(s.count(), 1);
});
test('HTTP error yields unknown rather than a new job', async t => {
  const s = await setup(t, (_req, res) => { res.writeHead(503); res.end('unavailable'); });
  const result = await mutate(s.client);
  assert.equal(JSON.parse(result.content[0].text).status, 'outcome_unknown'); assert.equal(s.count(), 1);
});
test('scope mismatch cannot certify success', async t => {
  const s = await setup(t, (req, res) => send(res, receipt(req, { scopeId: 'different-scope' })));
  const result = await mutate(s.client); assert.equal(result.isError, true); assert.match(result.content[0].text, /Mismatched/);
});
test('successful mutation without durable evidence is rejected', async t => {
  const s = await setup(t, (req, res) => send(res, receipt(req, { evidence: [] })));
  const result = await mutate(s.client); assert.equal(result.isError, true); assert.match(result.content[0].text, /durable receipt/);
});
test('actual artifact bytes must match returned SHA-256', async t => {
  let corrupt = false;
  const s = await setup(t, (req, res) => send(res, receipt(req, { data: { text: 'actual bytes', sha256: corrupt ? 'b'.repeat(64) : createHash('sha256').update('actual bytes').digest('hex') } })));
  assert.equal((await s.client.callTool({ name: 'read_artifact', arguments: {} })).isError, false);
  corrupt = true; assert.equal((await s.client.callTool({ name: 'read_artifact', arguments: {} })).isError, true);
});
