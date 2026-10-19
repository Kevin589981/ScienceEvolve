import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const { buildInvocationEnvironment } = await import('./vendor/sdk/dist/core/harness-runtime/process-host.js');
const scrubbed = buildInvocationEnvironment({ common: { PATH: process.env.PATH, HOME: '/tmp/pi-env-probe-home' } });
assert.equal(scrubbed.PYTHONPATH, undefined);
const envProbe = spawn(path.join(root, 'pi-entry.py'), ['--exam-environment-probe', 'deepmd'],
  { env: scrubbed, stdio: ['ignore', 'pipe', 'pipe'] });
let envOut = '', envErr = '';
envProbe.stdout.on('data', bytes => { envOut += bytes; });
envProbe.stderr.on('data', bytes => { envErr += bytes; });
const envCode = await new Promise(resolve => envProbe.once('close', resolve));
assert.equal(envCode, 0, envErr);
const restored = JSON.parse(envOut);
for (const key of ['PYTHONPATH', 'LD_LIBRARY_PATH', 'OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS']) {
  assert.equal(restored.environment[key], process.env[key], key);
}
assert.ok(restored.python_path.includes('/workspace/source'));
assert.ok(restored.imported_module_file.startsWith('/workspace/source/deepmd/'));
const pi = spawn(path.join(root, 'pi-entry.py'), ['--version'],
  { env: { ...process.env, PATH: path.join(root, 'runtime') + ':' + process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
let piOut = '', piErr = '';
pi.stdout.on('data', bytes => { piOut += bytes; });
pi.stderr.on('data', bytes => { piErr += bytes; });
const piCode = await new Promise(resolve => pi.once('close', resolve));
assert.equal(piCode, 0, piErr);
assert.match(piOut + piErr, /0\.74\.2/);
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ unixTransport: true }));
});
await new Promise(resolve => server.listen({ port: 0, host: '127.0.0.1' }, resolve));
try {
  const port = server.address().port;
  assert.equal(typeof port, 'number');
  const url = `http://127.0.0.1:${port}/probe`;
  assert.deepEqual(await (await fetch(url)).json(), { unixTransport: true });
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `const r=await fetch(${JSON.stringify(url)}); console.log(JSON.stringify(await r.json()));`],
    { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), { unixTransport: true });
  const externalError = await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('External connect did not fail promptly')); });
    socket.once('error', error => { socket.destroy(); resolve(error.code); });
    socket.once('connect', () => { socket.destroy(); reject(new Error('External TCP unexpectedly permitted')); });
  });
  assert.ok(['EPERM', 'EACCES', 'ENETUNREACH'].includes(externalError), externalError);
  console.log(JSON.stringify({ accepted: true, sameProcessLoopbackHttp: true, childProcessLoopbackHttp: true,
    externalTcpBlocked: true, externalError, bundledPiExecutableViaPath: true,
    sdkFilteredEnvironmentRestored: true, scientificSourceImportPassed: true }));
} finally { await new Promise(resolve => server.close(resolve)); }
