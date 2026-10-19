'use strict';
// The SDK's virtual provider origin uses the exam's fixed Unix model relay.
// Local SDK HTTP/MCP services remain inside the original network namespace.
if (!globalThis.__scienceBenchModelRelay) {
  globalThis.__scienceBenchModelRelay = true;
  const http = require('node:http');
  const { Readable } = require('node:stream');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin !== 'https://10.255.255.1') return originalFetch(input, init);
    const requestInput = typeof input === 'object' && !(input instanceof URL) ? input : undefined;
    const method = init.method || requestInput?.method || 'GET';
    const headers = Object.fromEntries(new Headers(init.headers || requestInput?.headers || {}).entries());
    const data = init.body !== undefined ? Buffer.from(init.body) :
      requestInput && !['GET', 'HEAD'].includes(method) ? Buffer.from(await requestInput.clone().arrayBuffer()) : Buffer.alloc(0);
    delete headers['transfer-encoding'];
    if (!['GET', 'HEAD'].includes(method)) headers['content-length'] = String(data.length);
    const signal = init.signal || requestInput?.signal;
    return new Promise((resolve, reject) => {
      const request = http.request({ socketPath: '/run/model.sock', path: url.pathname + url.search,
        method, headers, signal }, response => {
        const values = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined && !['transfer-encoding', 'connection'].includes(name)) values.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const result = new Response(Readable.toWeb(response), { status: response.statusCode, headers: values });
        Object.defineProperty(result, 'url', { value: url.toString() });
        resolve(result);
      });
      request.on('error', reject);
      request.end(data);
    });
  };
}
