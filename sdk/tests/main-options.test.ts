import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadMainRuntimeConfig, validateMainGatewayBindings, validateMainResearchSdkOptions } from "../src/main-options.js";
import { createMainResearchSdk } from "../src/main-client.js";

const roots: string[] = [];
afterEach(async () => {
  delete process.env.SCIENCEEVOLVE_MAIN_OPTIONS_TEST_TOKEN;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});
async function directory() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-main-options-")); roots.push(root); return root; }

describe("main deployment options (no model/provider requests)", () => {
  it.each([
    { runnerOptions: {} }, { internal: {} }, { gatewayOptions: {} }, { compute: {} },
    { timeouts: { residentAdapters: {} } }, { execution: { controlBridgeFactory: () => {} } },
    { execution: { agentConcurrency: "10" } }, { timeouts: { protocolProxyTimeoutMs: -1 } },
    { timeouts: { protocolProxyTimeoutMs: 2_147_483_648 } }, { git: { credentialResolver: "token" } },
    { skillRoots: ["relative/path"] },
    { sii: {} }, { sii: { inspireBin: "inspire", workspaceRoot: "." } }
  ])("refuses unsafe/malformed public options before creating any data: %j", async (extra) => {
    const root = await directory();
    const dataDir = path.join(root, "must-not-exist");
    await expect(createMainResearchSdk({ dataDir, ...extra } as never)).rejects.toThrow();
    await expect(fs.access(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("accepts partial execution tuning, copies options, and validates against effective retry defaults", async () => {
    const root = await directory();
    const input = { dataDir: root, execution: { agentConcurrency: 2 }, git: { expectedIdentity: { id: 42, login: "fixture" } } };
    const copy = validateMainResearchSdkOptions(input);
    input.execution.agentConcurrency = 4;
    expect(copy.execution?.agentConcurrency).toBe(2);
    expect(() => validateMainResearchSdkOptions({ dataDir: root, execution: { retryBaseMs: 60_001 } })).toThrow(/retryBaseMs/);
    expect(() => validateMainResearchSdkOptions({ dataDir: root, execution: { retryMaxMs: 1_000 } })).toThrow(/retryBaseMs/);
    const sdk = await createMainResearchSdk(copy);
    try { expect(await sdk.listRuns()).toEqual([]); } finally { await sdk.close(); }
  });
  it("resolves file-relative deployment paths, keeps credentials out of JSON, and reads rotated tokens lazily", async () => {
    const root = await directory();
    const file = path.join(root, "deployment.json");
    await fs.writeFile(file, JSON.stringify({ harnesses: { codex: "./bin/codex.js" }, skillRoots: ["./skills"], userSkillRoot: "./user-skills",
      execution: { agentConcurrency: 3 }, git: { tokenEnv: "SCIENCEEVOLVE_MAIN_OPTIONS_TEST_TOKEN", expectedIdentity: { id: 42, login: "fixture" } } }));
    const options = await loadMainRuntimeConfig(file);
    expect(options.harnesses?.codex).toBe(path.join(root, "bin", "codex.js"));
    expect(options.skillRoots).toEqual([path.join(root, "skills")]);
    expect(options.userSkillRoot).toBe(path.join(root, "user-skills"));
    await expect(options.git!.credentialResolver!()).rejects.toThrow(/empty or unset/);
    process.env.SCIENCEEVOLVE_MAIN_OPTIONS_TEST_TOKEN = "opaque-fixture-first";
    expect(await options.git!.credentialResolver!()).toEqual({ token: "opaque-fixture-first", requestedScopes: ["repo"] });
    process.env.SCIENCEEVOLVE_MAIN_OPTIONS_TEST_TOKEN = "opaque-fixture-rotated";
    expect((await options.git!.credentialResolver!()).token).toBe("opaque-fixture-rotated");
    expect(JSON.stringify(options)).not.toContain("opaque-fixture");
    const abort = new AbortController(); abort.abort(new Error("fixture abort"));
    await expect(options.git!.credentialResolver!(abort.signal)).rejects.toThrow("fixture abort");
  });
  it.each([
    { git: { token: "opaque-fixture-key" } }, { git: { credentialResolver: "callback" } },
    { dataDir: "not-allowed-in-file" }, { timeouts: { harnessExecutables: {} } },
    { harnesses: { codex: { executable: "node", args: ["cli"] } } },
    { execution: { controlBridgeFactory: "callback" } }, { skillRoots: [42] }
  ])("rejects credential values, legacy launch objects and private injections in runtime JSON: %j", async (input) => {
    const root = await directory(); const file = path.join(root, "deployment.json");
    await fs.writeFile(file, JSON.stringify(input));
    await expect(loadMainRuntimeConfig(file)).rejects.toThrow();
  });
  it("only accepts credential-free gateway bindings with a known shape", () => {
    expect(validateMainGatewayBindings({ defaultGatewayId: " default ", agents: { review: " review " } }))
      .toEqual({ defaultGatewayId: "default", agents: { review: "review" } });
    expect(() => validateMainGatewayBindings({ apiKey: "opaque-fixture" })).toThrow();
    expect(() => validateMainGatewayBindings({ agents: { main: { gatewayId: "g", apiKey: "opaque-fixture" } } })).toThrow();
  });
  it("requires explicit absolute SII paths and a bounded integer refresh interval", async () => {
    const root = await directory();
    const sii = { inspireBin: path.join(root, "inspire"), workspaceRoot: root };
    expect(validateMainResearchSdkOptions({ dataDir: root }).sii).toBeUndefined();
    expect(validateMainResearchSdkOptions({ dataDir: root, sii }).sii).toEqual(sii);
    for (const extra of [{ refreshMs: 999 }, { refreshMs: 1000.5 }, { refreshMs: 2_147_483_648 },
      { configPath: "relative" }, { knowledgeRoot: "relative" }, { noProxy: [42] },
      { runJson: () => {} }, { accountReader: () => "account" }, { token: "secret" }]) {
      expect(() => validateMainResearchSdkOptions({ dataDir: root, sii: { ...sii, ...extra } })).toThrow();
    }
    expect(validateMainResearchSdkOptions({ dataDir: root, sii: { ...sii, refreshMs: 1000 } }).sii?.refreshMs).toBe(1000);
  });
  it("resolves all SII deployment paths relative to runtime JSON", async () => {
    const root = await directory(); const file = path.join(root, "deployment.json");
    await fs.writeFile(file, JSON.stringify({ sii: { inspireBin: "./bin/inspire", workspaceRoot: "./workspace",
      configPath: "./config.yaml", knowledgeRoot: "./knowledge", noProxy: ["localhost"], refreshMs: 2000 } }));
    expect((await loadMainRuntimeConfig(file)).sii).toEqual({ inspireBin: path.join(root, "bin/inspire"),
      workspaceRoot: path.join(root, "workspace"), configPath: path.join(root, "config.yaml"),
      knowledgeRoot: path.join(root, "knowledge"), noProxy: ["localhost"], refreshMs: 2000 });
  });
});
