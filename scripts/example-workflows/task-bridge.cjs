'use strict';
// Transport only. Scientific decisions stay in SCIENCEEVOLVE agents; backends expose atomic tools.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { randomUUID, createHash } = require('node:crypto');
const spec = require('./tools.json');

function check(schema, value, at = 'arguments') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${at}: unsupported enum`);
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: object required`);
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) check(schema.properties[key], item, `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${at}.${key}: unknown field`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${at}: array required`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${at}: too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${at}: too many items`);
    for (const item of value) check(schema.items, item, `${at}[]`);
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error(`${at}: invalid string`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new Error(`${at}: invalid pattern`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${at}: invalid integer`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${at}: boolean required`);
  }
}

async function dispatch(tool, args) {
  check(tool.inputSchema, args);
  const raw = process.env.SCIENCEEVOLVE_TASK_BACKEND_URL;
  const scopeId = process.env.SCIENCEEVOLVE_TASK_SCOPE_ID;
  if (!raw || !scopeId) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: 'blocked', reason: 'Configure the method-specific backend URL and a fresh scope ID; no backend is bundled.' }) }] };
  const endpoint = new URL(raw);
  if (!(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Use an explicit HTTPS or loopback HTTP endpoint without inline credentials');
  const requestId = tool.mode === 'write' ? args.requestId : randomUUID();
  if (tool.mode === 'write' && !requestId) throw new Error('Mutation requires a stable requestId');
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', ...(process.env.SCIENCEEVOLVE_TASK_BACKEND_TOKEN ? { authorization: `Bearer ${process.env.SCIENCEEVOLVE_TASK_BACKEND_TOKEN}` } : {}) },
      body: JSON.stringify({ schemaVersion: 1, method: spec.method, scopeId, actor: spec.actor, operation: tool.name, requestId, arguments: args })
    });
  } catch {
    // Never retry a possibly accepted training/physical job automatically.
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: tool.mode === 'write' ? 'outcome_unknown' : 'unavailable', requestId, operation: tool.name, reason: 'Transport failed; reconcile this exact requestId using get_request. Do not create a replacement job.' }) }] };
  }
  if (!response.ok) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ status: tool.mode === 'write' ? 'outcome_unknown' : 'unavailable', requestId, operation: tool.name, httpStatus: response.status, reason: 'Reconcile before replaying any mutation.' }) }] };
  const body = await response.text();
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('Backend response too large; use paged evidence');
  const result = JSON.parse(body);
  if (result.schemaVersion !== 1 || result.method !== spec.method || result.scopeId !== scopeId || result.operation !== tool.name || result.requestId !== requestId) throw new Error(`Mismatched backend receipt; mutation outcome remains unknown: ${requestId}`);
  if (!['ok', 'blocked', 'failed', 'unknown'].includes(result.status)) throw new Error(`Invalid receipt status: ${requestId}`);
  if (!Array.isArray(result.evidence)) throw new Error(`Receipt requires an evidence array: ${requestId}`);
  for (const evidence of result.evidence) {
    if (!evidence || typeof evidence.id !== 'string' || typeof evidence.uri !== 'string' || typeof evidence.kind !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error(`Malformed evidence reference: ${requestId}`);
  }
  if (tool.mode === 'write' && result.status === 'ok' && result.evidence.length === 0) throw new Error(`Successful mutation requires a durable receipt: ${requestId}`);
  if (tool.name === 'read_artifact' && result.status === 'ok') {
    if (typeof result.data?.text !== 'string' || createHash('sha256').update(result.data.text, 'utf8').digest('hex') !== result.data.sha256) throw new Error('Artifact bytes do not match the claimed SHA-256');
  }
  // Evidence references and an HTTP OK are not a scientific pass. Agents audit actual bytes/results.
  return { isError: result.status !== 'ok', content: [{ type: 'text', text: JSON.stringify(result) }] };
}

const server = new Server({ name: `${spec.method}-${spec.actor}-atomic-tools`, version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: spec.tools.map(({ mode, ...tool }) => tool) }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const tool = spec.tools.find(item => item.name === request.params.name);
  if (!tool) throw new Error('Tool is not assigned to this role');
  try { return await dispatch(tool, request.params.arguments || {}); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
});
server.connect(new StdioServerTransport());
process.stdin.on('end', () => { server.close().finally(() => process.exit()); });
