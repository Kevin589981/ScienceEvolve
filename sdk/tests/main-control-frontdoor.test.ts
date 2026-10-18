import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { StableControlFrontdoor, residentControlRequestTimeoutMs } from "../src/core/harness-runtime/resident-runtime-adapter.js";
import { CONTROL_OPERATION_TIMEOUT_MS, CONTROL_REQUEST_TIMEOUT_MS, CONTROL_PROXY_TIMEOUT_MS, CONTROL_DRAIN_TIMEOUT_MS } from "../src/core/control-request-lifetime.js";
import type { CapabilityContext } from "../src/core/orchestration-control-mcp.js";

describe("resident control socket isolation (actual loopback sockets; no model)", () => {
  it("keeps discovery bounded but gives provider tools a budget longer than a GitHub request", () => {
    expect(residentControlRequestTimeoutMs({ method: "initialize" })).toBe(10_000);
    expect(residentControlRequestTimeoutMs({ method: "tools/list" })).toBe(10_000);
    expect(residentControlRequestTimeoutMs({ method: "tools/call", params: { name: "github_merge_pr" } })).toBe(CONTROL_REQUEST_TIMEOUT_MS);
    expect(CONTROL_REQUEST_TIMEOUT_MS).toBeGreaterThan(CONTROL_OPERATION_TIMEOUT_MS);
    expect(CONTROL_PROXY_TIMEOUT_MS).toBeGreaterThan(CONTROL_REQUEST_TIMEOUT_MS);
    expect(CONTROL_DRAIN_TIMEOUT_MS).toBeGreaterThan(CONTROL_PROXY_TIMEOUT_MS);
  });
  it("passes an actual delayed tool response through the stdio proxy beyond the old ten-second cutoff", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-control-slow-provider-"));
    const discovery: CapabilityContext = { secret: "fixture", projectId: "fixture", agent: "main", invocationId: "fixture",
      stateVersion: 1, kind: "main", candidates: [], decisionBy: "main", allowUserIntervention: false, canComplete: false,
      stagingPath: path.join(root, "actions.json"), workspacePath: root };
    const frontdoor = await StableControlFrontdoor.open(root, discovery);
    let calls = 0;
    frontdoor.rotate({ forward: async (request: { id: unknown }) => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 11_000));
      return { jsonrpc: "2.0", id: request.id, result: { delayedProvider: true } };
    } } as never);
    const child = spawn(frontdoor.row.command!, frontdoor.row.args!, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    try {
      let text = "", stderr = "";
      const response = new Promise<Record<string, unknown>>((resolve, reject) => {
        child.once("error", reject);
        child.stderr.on("data", chunk => { stderr += String(chunk); });
        child.stdout.on("data", chunk => { text += String(chunk); if (text.includes("\n")) resolve(JSON.parse(text.trim())); });
        child.once("exit", () => { if (!text.includes("\n")) reject(new Error(`Proxy exited: ${stderr}`)); });
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "github_merge_pr", arguments: {} } }) + "\n");
      expect(await response).toMatchObject({ id: 7, result: { delayedProvider: true } });
      expect(calls).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once("exit", resolve));
        child.kill(); await exited;
      }
      await frontdoor.close(); await fs.rm(root, { recursive: true, force: true });
    }
  }, 25_000);
  it("keeps an already dispatched operation draining after the client disconnects, without replaying it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-control-drain-"));
    const discovery: CapabilityContext = { secret: "fixture", projectId: "fixture", agent: "main", invocationId: "fixture",
      stateVersion: 1, kind: "main", candidates: [], decisionBy: "main", allowUserIntervention: false, canComplete: false,
      stagingPath: path.join(root, "actions.json"), workspacePath: root };
    const frontdoor = await StableControlFrontdoor.open(root, discovery);
    let client: net.Socket | undefined, release!: () => void, entered!: () => void, calls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; }), entry = new Promise<void>((resolve) => { entered = resolve; });
    const downstream = { forward: async () => { calls++; entered(); await gate; return { id: 1, result: {} }; } };
    try {
      const config = JSON.parse(await fs.readFile(frontdoor.row.args!.at(-1)!, "utf8"));
      frontdoor.rotate(downstream as never);
      client = net.createConnection({ host: config.host, port: config.port }); client.on("error", () => {});
      client.once("connect", () => client!.write(JSON.stringify({ capability: config.token, request: { id: 1, method: "tools/call", params: { name: "fixture" } } }) + "\n"));
      await entry; client.resetAndDestroy();
      let drained = false; const drain = frontdoor.drain(downstream as never).then(() => { drained = true; });
      await new Promise((resolve) => setTimeout(resolve, 20)); expect(drained).toBe(false);
      release(); await drain;
      expect(calls).toBe(1); await frontdoor.assertReady();
    } finally { release(); client?.destroy(); await frontdoor.close(); await fs.rm(root, { recursive: true, force: true }); }
  });
  it("survives a reset and an oversized request without granting control or closing the host", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-control-frontdoor-"));
    const discovery: CapabilityContext = { secret: "fixture", projectId: "fixture", agent: "main", invocationId: "fixture",
      stateVersion: 1, kind: "main", candidates: [], decisionBy: "main", allowUserIntervention: false, canComplete: false,
      stagingPath: path.join(root, "actions.json"), workspacePath: root };
    const frontdoor = await StableControlFrontdoor.open(root, discovery);
    try {
      const config = JSON.parse(await fs.readFile(frontdoor.row.args!.at(-1)!, "utf8"));
      await new Promise<void>((resolve, reject) => {
        const client = net.createConnection({ host: config.host, port: config.port });
        client.on("error", () => {}); client.once("connect", () => client.resetAndDestroy()); client.once("close", () => resolve());
        setTimeout(() => { client.destroy(); reject(new Error("Reset timeout")); }, 3000).unref();
      });
      await new Promise<void>((resolve, reject) => {
        const client = net.createConnection({ host: config.host, port: config.port });
        client.on("error", () => {}); client.once("connect", () => client.write("x".repeat(1024 * 1024 + 1)));
        client.once("close", () => resolve());
        setTimeout(() => { client.destroy(); reject(new Error("Oversize timeout")); }, 3000).unref();
      });
      await frontdoor.assertReady();
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const client = net.createConnection({ host: config.host, port: config.port });
        client.on("error", reject); client.setEncoding("utf8"); let text = "";
        client.once("connect", () => client.write(JSON.stringify({ capability: config.token, request: { id: 1, method: "initialize" } }) + "\n"));
        client.on("data", (chunk) => { text += chunk; if (text.includes("\n")) { client.end(); resolve(JSON.parse(text.trim())); } });
        setTimeout(() => { client.destroy(); reject(new Error("Initialize timeout")); }, 3000).unref();
      });
      expect(response).toMatchObject({ ok: true, response: { id: 1, result: { serverInfo: { name: "scienceevolve-resident-control" } } } });
      await frontdoor.assertReady();
    } finally { await frontdoor.close(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
