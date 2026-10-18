import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { MainNativeCodexProfiles } from "../src/main-native-profiles.js";
import { validateMainGatewayBindings, validateMainResearchSdkOptions } from "../src/main-options.js";
import { validateMainWorkflowConfig } from "../src/main-config.js";
import { openInvocationModelRoute } from "../src/core/harness-runtime/gateway-route.js";
import { harnessCatalogRegistry } from "../src/core/harness-runtime/registry.js";
import type { AgentRunRequest } from "../src/core/types.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function directories() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-native-profile-")); roots.push(root);
  const profile = path.join(root, "profile"), data = path.join(root, "data");
  await fs.mkdir(profile); await fs.mkdir(data);
  await fs.writeFile(path.join(profile, "config.toml"), 'model_provider="custom"\n');
  await fs.writeFile(path.join(profile, "auth.json"), "opaque-fixture-never-read-or-copied");
  return { root, profile, data };
}
describe("trusted native Codex profile authority (no model/network)", () => {
  it("pins deployment aliases without copying credentials/config and refuses changed bindings on reopen", async () => {
    const { profile, data } = await directories(), store = new MainNativeCodexProfiles();
    await store.initialize(data, { login: profile }, true);
    expect(await store.resolve("login")).toBe(await fs.realpath(profile));
    expect(await fs.readdir(data)).toEqual([".scienceevolve-native-codex-profiles.json"]);
    expect(await fs.readFile(path.join(profile, "config.toml"), "utf8")).toBe('model_provider="custom"\n');
    await expect(new MainNativeCodexProfiles().initialize(data, {}, false)).rejects.toThrow(/bindings changed/);
    const reopened = new MainNativeCodexProfiles(); await reopened.initialize(data, { login: profile }, false);
    await expect(reopened.resolve("other")).rejects.toThrow(/Unknown native/);
  });
  it("requires explicit, non-conflicting routes and keeps profile values out of portable workflows", () => {
    expect(validateMainGatewayBindings({ defaultNativeCodexProfileId: "login", agents: { main: { nativeCodexProfileId: "login" } } })).toMatchObject({ defaultNativeCodexProfileId: "login" });
    expect(() => validateMainGatewayBindings({ defaultNativeCodexProfileId: "login", defaultGatewayId: "gwy_fixture" })).toThrow(/one default/);
    expect(() => validateMainResearchSdkOptions({ dataDir: os.tmpdir(), nativeCodexProfiles: { login: "relative" } })).toThrow(/absolute/);
    expect(() => validateMainWorkflowConfig({ agents: { main: { nativeCodexProfileId: "login" } } })).toThrow(/profile values/);
  });
  it("refuses an aliased profile registry on reopen", async () => {
    const { profile, data } = await directories(), store = new MainNativeCodexProfiles();
    await store.initialize(data, { login: profile }, true);
    await fs.link(path.join(data, ".scienceevolve-native-codex-profiles.json"), path.join(data, "registry-alias.json"));
    await expect(new MainNativeCodexProfiles().initialize(data, { login: profile }, false)).rejects.toThrow(/regular private file/);
  });
  it("opens nonce-isolated native turns without proxy/gateway secrets and rejects mixed/harness/probe routes", async () => {
    const { profile } = await directories();
    const request = { purpose: "workflow", agent: "main", project: { agents: { main: { harness: "codex", nativeCodexProfileId: "login", model: "fixture" } } } } as unknown as AgentRunRequest;
    const descriptor = harnessCatalogRegistry.descriptor("codex"), signal = new AbortController().signal;
    const options = { protocolProxyFactory: async () => { throw new Error("Native route must not open a proxy"); } };
    const first = await openInvocationModelRoute(descriptor, request, () => {}, signal, options as never, async () => profile);
    const second = await openInvocationModelRoute(descriptor, request, () => {}, signal, options as never, async () => profile);
    expect(first).toHaveProperty("nativeCodexProfileHome", profile); expect(first).not.toHaveProperty("token"); expect(first).not.toHaveProperty("baseUrl");
    expect((first as { authorityId: string }).authorityId).not.toBe((second as { authorityId: string }).authorityId);
    await first.close(); await second.close();
    await expect(openInvocationModelRoute(descriptor, request, () => {}, signal, options as never)).rejects.toThrow(/Invalid native/);
    await expect(openInvocationModelRoute(descriptor, { ...request, purpose: "probe" }, () => {}, signal, options as never, async () => profile)).rejects.toThrow(/Invalid native/);
    await expect(openInvocationModelRoute(harnessCatalogRegistry.descriptor("pi"), request, () => {}, signal, options as never, async () => profile)).rejects.toThrow(/Invalid native/);
    request.project.agents.main.gatewayId = "gwy_fixture";
    await expect(openInvocationModelRoute(descriptor, request, () => {}, signal, options as never, async () => profile)).rejects.toThrow(/Invalid native/);
  });
});
