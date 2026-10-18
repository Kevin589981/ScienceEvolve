import { describe, expect, it } from "vitest";
import { codexAppServerCodec, type ResidentProtocolConnection } from "../src/core/harness-runtime/resident-native-driver.js";
import type { SessionRef } from "../src/core/harness-runtime/contracts.js";
import type { ResidentTurn } from "../src/core/harness-runtime/resident-lease.js";

const session: SessionRef = { schemaVersion: 1, harnessId: "codex", adapterVersion: "fixture", generation: 0,
  nativeId: "pending:fixture", durable: true, createdAt: new Date().toISOString() };
function fixture(background: Record<string, unknown>[] = []) {
  let id = 0;
  const frames: Record<string, unknown>[] = [], notified: Record<string, unknown>[] = [];
  let allowed: ((frame: Readonly<Record<string, unknown>>) => boolean) | undefined;
  const connection: ResidentProtocolConnection = {
    requestId: () => ++id,
    async send(frame) {
      if (frame.method === "initialize") frames.push({ id: frame.id, result: {} });
      if (frame.method === "thread/start") frames.push({ id: frame.id, result: { thread: { id: "thread-fixture" } } });
      if (frame.method === "turn/start") frames.push({ id: frame.id, result: { turn: { id: "turn-fixture" } } }, ...background,
        { method: "turn/completed", params: { threadId: "thread-fixture", turn: { id: "turn-fixture", status: "completed", items: [] } } });
    },
    async next(predicate) { const frame = frames.shift(); if (!frame || !predicate(frame)) throw new Error("Missing fixture frame"); return frame; },
    notify: (frame) => { notified.push(frame); },
    async consumeInitializationNotifications(predicate) { allowed = predicate; }
  };
  const codec = codexAppServerCodec({ cwd: process.cwd(), model: "fixture", sandbox: "read-only" });
  return { codec, connection, notified, allowed: (frame: Record<string, unknown>) => allowed!(frame) };
}
describe("Codex native OAuth background metadata (simulated wire, actual codec)", () => {
  it("accepts only the exact non-business OAuth/skills notifications at idle boundaries", async () => {
    const f = fixture(), opened = await f.codec.initialize(f.connection, session);
    await f.codec.settleIdle!(f.connection, opened);
    expect(f.allowed({ method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } })).toBe(true);
    expect(f.allowed({ method: "account/updated", params: { authMode: null, planType: null } })).toBe(true);
    expect(f.allowed({ method: "skills/changed", params: {} })).toBe(true);
    for (const frame of [
      { id: 1, method: "skills/changed", params: {} },
      { method: "skills/changed", params: { toolCall: "injected" } },
      { method: "account/updated", params: { authMode: "unknown", planType: "plus" } },
      { method: "account/updated", params: { authMode: "chatgpt", planType: "plus", token: "injected" } },
      { method: "item/completed", params: { threadId: "thread-fixture" } },
      { method: "unexpected/changed", params: {} }
    ]) expect(f.allowed(frame)).toBe(false);
  });
  it("handles notifications racing with a real codec turn without attributing metadata to tools", async () => {
    const f = fixture([{ method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } }, { method: "skills/changed", params: {} }]);
    const opened = await f.codec.initialize(f.connection, session);
    await expect(f.codec.submit(f.connection, opened, { inputId: "input", invocationId: "inv", prompt: "test" } as ResidentTurn)).resolves.toHaveProperty("threadId", "thread-fixture");
    expect(f.notified.map((frame) => frame.method)).not.toContain("skills/changed");
    expect(f.notified.map((frame) => frame.method)).not.toContain("account/updated");
  });
  it("still rejects injected business data in a nominal background notification", async () => {
    const f = fixture([{ method: "skills/changed", params: { threadId: "other", turnId: "other" } }]);
    const opened = await f.codec.initialize(f.connection, session);
    await expect(f.codec.submit(f.connection, opened, { inputId: "input", invocationId: "inv", prompt: "test" } as ResidentTurn)).rejects.toThrow(/unknown or out-of-turn/);
  });
});
