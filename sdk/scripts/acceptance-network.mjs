// Optional acceptance-host workaround for intermittent GitHub read transport.
// Actual SDK/public API and provider responses remain unchanged. Never replay
// mutations here: provider journals own uncertain write reconciliation.
export function configureAcceptanceReadRetries() {
  if (process.env.SDK_ACCEPTANCE_RETRY_GITHUB_READS !== '1') return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const eligible = url.origin === 'https://api.github.com' && ['GET', 'HEAD'].includes(method);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    for (let attempt = 0; ; attempt++) {
      try { return await nativeFetch(input, init); }
      catch (error) {
        if (!eligible || !(error instanceof TypeError) || signal?.aborted || attempt >= 2) throw error;
        process.stdout.write(JSON.stringify({ type: 'github.read.transport.retry', attempt: attempt + 1 }) + '\n');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
  };
}
