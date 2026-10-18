import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentContextSources, publishAgentContextIndex } from "../../src/core/agent-context-index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openfars-context-index-")); roots.push(root);
  return { root, inbox: path.join(root, "Inbox.md") };
}
async function read(file: string) { return JSON.parse(await fs.readFile(file, "utf8")); }

describe("on-demand Agent context", () => {
  it("separates nested draft Agent maps and tool catalogs into selectable records", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    const agents = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`agent-${index}`, { instructions: `DETAIL-${index}`.repeat(2000) }]));
    sources.fields("assistant", "Assistant evidence", { draft: { title: "Draft", agents,
      skillDefinitions: { method: { files: { "SKILL.md": "SELECTED_SKILL" } } } }, catalog: { availableRoutes: [{ id: "route-1" }] } });
    expect(sources.sources.map(source => source.key)).toContain("assistant.draft.agents");
    expect(sources.sources.some(source => source.key === "assistant.draft")).toBe(false);
    const published = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(published.preview).not.toContain("DETAIL-");
    const directory = path.dirname(published.indexPath), index = await read(published.indexPath);
    const source = index.entries.find((entry: any) => entry.key === "assistant.draft.agents");
    const list = await read(path.join(directory, source.list.path));
    expect(list.total).toBe(65); expect(list.entries).toHaveLength(65);
    expect(list.entries.at(-1).agentId).toBe("agent-64"); expect(list.nextPage).toBeUndefined();
    expect(list.entries[0]).toMatchObject({ agentId: "agent-0" });
    expect(JSON.stringify(list)).not.toContain("DETAIL-");
    expect(await read(path.join(directory, list.entries[0].detail.path))).toEqual({ agentId: "agent-0", ...agents["agent-0"] });
  });

  it("makes large text fields independently readable instead of combining them in metadata", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    sources.fields("project", "Project fields", { status: "running", requirement: "CURRENT-TASK".repeat(1000),
      earlierHistory: "OLD-DETAIL".repeat(10_000) });
    expect(sources.sources.map(source => source.key)).toEqual(["project.requirement", "project.earlierHistory", "project.metadata"]);
    expect(sources.sources.find(source => source.key === "project.metadata")!.records).toEqual([{ status: "running" }]);
    const result = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(result.preview).not.toContain("CURRENT-TASK"); expect(result.preview).not.toContain("OLD-DETAIL");
  });

  it("keeps growing receipt histories out of messages while retaining exact individual records", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    const records = Array.from({ length: 65 }, (_, i) => ({ id: `receipt-${i}`, status: "stopped",
      output: `PRIVATE-DETAIL-${i}: ${"历史原始内容".repeat(2000)}`, request: { original: i } }));
    const notice = sources.list("receipts", "Original receipt history", records);
    const published = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(notice + published.preview).not.toContain("PRIVATE-DETAIL");
    expect(published.preview.length).toBeLessThan(JSON.stringify(records).length / 10);
    for (const record of records) expect(published.preview).toContain(`"id":"${record.id}"`);
    const directory = path.dirname(published.indexPath);
    const sourceList = await read(published.indexPath);
    const file = path.join(directory, sourceList.entries[0].list.path);
    const listed: unknown[] = [];
    const index = await read(file);
    expect(index.entries).toHaveLength(65); expect(index.nextPage).toBeUndefined(); expect(index.lastPage).toBeUndefined();
    for (const entry of index.entries) {
      expect(entry.output).toBeUndefined(); expect(entry.request).toBeUndefined();
      const body = await read(path.join(directory, entry.detail.path));
      expect(body).toEqual(records[entry.index]); listed.push(body);
    }
    expect(listed).toEqual(records);
  });

  it("lists every source in the prompt and root index without hiding later sources", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    for (let index = 0; index < 65; index++) sources.record(`source-${index}`, `Available source ${index}`, { id: `record-${index}`, output: "DETAIL_BODY" });
    const published = (await publishAgentContextIndex(inbox, sources.sources))!;
    const index = await read(published.indexPath);
    expect(index.entries).toHaveLength(65); expect(index.nextPage).toBeUndefined();
    for (let i = 0; i < 65; i++) expect(published.preview).toContain(`source="source-${i}"`);
    expect(published.preview).not.toContain("DETAIL_BODY");
  });

  it("keeps list metadata bounded even when names and outputs are very large", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    sources.record("details", "Large detail", { id: "x".repeat(5000), name: "y".repeat(5000), output: "secret-details" });
    const result = (await publishAgentContextIndex(inbox, sources.sources))!;
    const directory = path.dirname(result.indexPath); const catalog = await read(result.indexPath);
    const listText = await fs.readFile(path.join(directory, catalog.entries[0].list.path), "utf8");
    expect(listText.length).toBeLessThan(1500); expect(listText).not.toContain("secret-details");
  });

  it("supports empty lists and does not make empty context into a mandatory read", async () => {
    const { inbox } = await fixture(); expect(await publishAgentContextIndex(inbox, [])).toBeUndefined();
    const sources = new AgentContextSources(); sources.list("empty", "No pending records", []);
    const result = (await publishAgentContextIndex(inbox, sources.sources))!;
    const directory = path.dirname(result.indexPath), index = await read(result.indexPath);
    expect(await read(path.join(directory, index.entries[0].list.path))).toMatchObject({ total: 0, entries: [] });
  });

  it("reuses immutable records on subsequent turns without changing old snapshots", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    sources.record("one", "Original facts", { id: "original", status: "unknown" });
    const first = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(await publishAgentContextIndex(inbox, sources.sources)).toEqual(first);
    sources.record("one", "Original facts", { id: "original", status: "observed" });
    const next = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(next.indexPath).not.toBe(first.indexPath); expect((await read(first.indexPath)).entries).toHaveLength(1);
  });

  it("does not interpret record identifiers as filesystem paths", async () => {
    const { root, inbox } = await fixture(); const sources = new AgentContextSources();
    sources.record("../../outside", "Arbitrary logical identifier", { id: "../../outside", value: "retained" });
    const result = (await publishAgentContextIndex(inbox, sources.sources))!;
    expect(path.dirname(result.indexPath)).toBe(path.join(root, "context-records"));
    expect((await fs.readdir(root)).sort()).toEqual(["context-records"]);
  });

  it("publishes complete identical records under concurrent snapshot preparation", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources();
    sources.record("x", "Shared facts", { id: "x", output: "完整历史".repeat(20_000) });
    const results = await Promise.all(Array.from({ length: 5 }, () => publishAgentContextIndex(inbox, sources.sources)));
    expect(new Set(results.map(value => value!.indexPath)).size).toBe(1);
  });

  it("rejects redirected context directories before writing anything", async () => {
    const { root, inbox } = await fixture(); const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openfars-context-outside-")); roots.push(outside);
    await fs.symlink(outside, path.join(root, "context-records"), process.platform === "win32" ? "junction" : "dir");
    const sources = new AgentContextSources(); sources.record("x", "Facts", { id: "x" });
    await expect(publishAgentContextIndex(inbox, sources.sources)).rejects.toThrow(/pinned/);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("rejects a tampered immutable list rather than presenting false references", async () => {
    const { inbox } = await fixture(); const sources = new AgentContextSources(); sources.record("x", "Facts", { id: "x" });
    const first = (await publishAgentContextIndex(inbox, sources.sources))!;
    await fs.chmod(first.indexPath, 0o600); await fs.writeFile(first.indexPath, "{}");
    await expect(publishAgentContextIndex(inbox, sources.sources)).rejects.toThrow(/immutable/);
  });
});
