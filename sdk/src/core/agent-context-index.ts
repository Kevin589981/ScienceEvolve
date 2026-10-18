import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { redactTrace } from "./utils.js";

/** Server-owned context, kept out of model messages until explicitly read. */
export interface AgentContextSource {
  key: string;
  label: string;
  records: unknown[];
}
export interface AgentContextIndex {
  indexPath: string;
  preview: string;
}
export type AgentContextPublisher = (sources: readonly AgentContextSource[]) => Promise<string>;

export class AgentContextSources {
  readonly sources: AgentContextSource[] = [];
  record(key: string, label: string, value: unknown): string {
    return this.list(key, label, [value]);
  }
  list(key: string, label: string, records: readonly unknown[]): string {
    this.sources.push({ key, label, records: [...records] });
    return `${label}: ${records.length} record(s), source=${JSON.stringify(key)} in the on-demand context index. Open its list and only the relevant detail records.`;
  }
  fields(prefix: string, label: string, value: Record<string, unknown>): string {
    const notices: string[] = [];
    const metadata: Record<string, unknown> = {};
    for (const [key, data] of Object.entries(value)) {
      if (Array.isArray(data)) notices.push(this.list(`${prefix}.${key}`, `${label} / ${key}`, data));
      else if (data && typeof data === "object") {
        if (["agents", "skillDefinitions", "mcpDefinitions", "routes", "decisionPlans"].includes(key)) {
          const records = Object.entries(data).map(([name, value]) => key === "agents"
            ? { agentId: name, ...(value && typeof value === "object" && !Array.isArray(value) ? value : { value }) }
            : { name, definition: value });
          notices.push(this.list(`${prefix}.${key}`, `${label} / ${key}`, records));
        } else if (["scopedRuntime", "draft", "catalog", "project", "workflow", "evidence", "orchestration", "scopedWorkflow"].includes(key)) {
          notices.push(this.fields(`${prefix}.${key}`, `${label} / ${key}`, data as Record<string, unknown>));
        }
        else notices.push(this.record(`${prefix}.${key}`, `${label} / ${key}`, data));
      } else if (typeof data === "string" && data.length > 1000) {
        notices.push(this.record(`${prefix}.${key}`, `${label} / ${key}`, data));
      } else metadata[key] = data;
    }
    if (Object.keys(metadata).length) notices.unshift(this.record(`${prefix}.metadata`, `${label} / metadata`, metadata));
    return notices.join("\n");
  }
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const json = (value: unknown) => `${redactTrace(JSON.stringify(value, null, 2) ?? "null")}\n`;
const brief = (value: string, maximum: number) => value.replace(/[\r\n]+/g, " ").slice(0, maximum);

/** Metadata only: never copy outputs, instructions, requests, memories, or
 * arbitrary extension fields into a default list response. */
export function agentContextRecordMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(["id", "requestId", "invocationId", "operationId", "executionId", "taskId", "agentId",
    "groupRunId", "groupId", "nodeId", "nodeRunId", "arrivalRequestId", "sourceRunId", "ownerExecutionId", "path", "name", "kind", "type", "status", "role", "model", "harness", "gatewayId", "nativeProtocol", "gatewayProtocol", "ownershipEpoch", "coordinatorEpoch", "createdAt", "recordedAt", "bytes", "size"]
    .flatMap(key => typeof record[key] === "string" && (record[key] as string).length <= 1024 ||
      typeof record[key] === "number" || typeof record[key] === "boolean" ? [[key, record[key]]] : []));
}

/** Publish immutable, individually addressable records next to the already
 * staged Inbox. All harnesses use their existing authorized file readers.
 * Every index lists all entries; full detail bodies remain on demand. */
export async function publishAgentContextIndex(inboxPath: string,
  supplied: readonly AgentContextSource[]): Promise<AgentContextIndex | undefined> {
  if (!supplied.length) return undefined;
  const sources = [...new Map(supplied.map(source => [source.key, source])).values()];
  const parent = path.resolve(path.dirname(inboxPath));
  await pinnedDirectory(parent);
  const base = path.join(parent, "context-records");
  await pinnedDirectory(base);
  const sourceEntries: Array<Record<string, unknown>> = [];
  const visibleIndex: string[] = [];
  for (const source of sources) {
    const entries: Array<Record<string, unknown>> = [];
    for (const [index, value] of source.records.entries()) {
      const text = json(value);
      const hash = digest(text);
      const file = path.join(base, `${hash}.json`);
      await immutableFile(file, text);
      entries.push({ index, ...agentContextRecordMetadata(value),
        detail: { path: path.basename(file), bytes: Buffer.byteLength(text), sha256: hash } });
    }
    const indexPath = await indexFile(base, { source: source.key, label: source.label }, entries);
    sourceEntries.push({ key: source.key, label: source.label, total: entries.length,
      list: { path: path.basename(indexPath) } });
    visibleIndex.push(`- ${brief(source.label, 120)}: ${entries.length} record(s); source=${JSON.stringify(source.key)}.`,
      ...entries.map(entry => {
        const detail = entry.detail as { path: string; bytes: number };
        // Complete, concise metadata goes directly into the native input.
        // Do not depend on a Harness preserving a large tool-return preview.
        return `  ${redactTrace(JSON.stringify({ ...entry, detail: { path: detail.path, bytes: detail.bytes } }))}`;
      }));
  }
  const indexPath = await indexFile(base, { kind: "agent-context-index" }, sourceEntries);
  return { indexPath, preview: [
    "On-demand context sources (lists only; detail bodies are not in this message):",
    ...visibleIndex,
    `Context index: ${indexPath}`,
    "Every source and entry is listed above without pagination or an entry-count cutoff. Select a needed detail.path directly; complete index files are also retained at the referenced paths. All relative paths are relative to the directory containing this index. Use the existing file tool's rootId/path reference. Read large individual detail records with offset/maxBytes. Do not load all detail bodies or an entire history by default. These immutable snapshots do not override current formal tool results, permissions, or project state."
  ].join("\n") };
}

async function indexFile(directory: string, metadata: Record<string, unknown>, entries: unknown[]): Promise<string> {
  const text = json({ ...metadata, total: entries.length, entries });
  const file = path.join(directory, `${digest(text)}.json`);
  await immutableFile(file, text);
  return file;
}

async function pinnedDirectory(directory: string): Promise<void> {
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory)
    throw new Error("Agent context directory must be a pinned regular directory");
}

const pendingFiles = new Map<string, Promise<void>>();
async function immutableFile(file: string, text: string): Promise<void> {
  const existing = pendingFiles.get(file);
  if (existing) return existing;
  const pending = writeImmutableFile(file, text);
  pendingFiles.set(file, pending);
  try { await pending; }
  finally { if (pendingFiles.get(file) === pending) pendingFiles.delete(file); }
}

async function writeImmutableFile(file: string, text: string): Promise<void> {
  const verify = async (): Promise<boolean> => {
    let handle;
    try { handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || await handle.readFile("utf8") !== text)
        throw new Error("Agent context record differs from its immutable source");
      return true;
    } finally { await handle.close(); }
  };
  if (await verify()) return;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o400);
    try { await handle.writeFile(text, "utf8"); } finally { await handle.close(); }
    // Publish a complete file atomically. Concurrent identical publishers
    // never expose a partially written record or change its content identity.
    if (!await verify()) await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}
