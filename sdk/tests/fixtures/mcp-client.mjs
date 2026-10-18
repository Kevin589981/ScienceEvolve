import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Exercise the runtime's local MCP endpoint using the protocol's own client.
export async function connectMcp(server) {
  const client = new Client({ name: "scienceevolve-test-consumer", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { redirect: "error" }
    }), { timeout: 30_000 });
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}
