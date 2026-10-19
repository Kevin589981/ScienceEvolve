import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
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
    externalTcpBlocked: true, externalError }));
} finally { await new Promise(resolve => server.close(resolve)); }
