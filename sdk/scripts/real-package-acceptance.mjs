// Opt-in: real OAuth through an external installed package's default public API.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [consumer, output, home] = process.argv.slice(2);
if (process.argv.length !== 5 || ![consumer, output, home].every((value) => typeof value === "string" && path.isAbsolute(value))) {
  throw new Error("External consumer, new output and native home required");
}
// Use ESM resolution in the external consumer (the package has import-only exports).
const entry = execFileSync(process.execPath, ["--input-type=module", "-e", 'process.stdout.write(import.meta.resolve("@scienceevolve/sdk"))'], {
  cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
}).trim();
const { createResearchSdk, validateWorkflowConfig } = await import(entry);
if (typeof createResearchSdk !== "function" || typeof validateWorkflowConfig !== "function") throw new Error("Default public API missing");
await fs.mkdir(output, { recursive: false });
const before = await fs.readFile(path.join(home, "config.toml"));
const native = { nativeCodexProfiles: { acceptance: home } };
const workflow = validateWorkflowConfig({ git: { enabled: false }, agents: { main: {
  harness: "codex", model: "gpt-6.1-sol", permission: "workspace", skills: [], autoSkills: [],
  instructions: "Bounded installed-package OAuth acceptance. Use scienceevolve_read_invocation_input to read this invocation's Inbox and Memory in complete bounded chunks. No shell, external services, other Agents, business file writes or credential inspection are allowed. After reading these inputs, reply with SCIENCEEVOLVE_INSTALLED_DEFAULT_ACCEPTED and use the authorized complete_project and finish_task tools."
} }, orchestration: { schemaVersion: 2, collaborations: [], agents: [{ name: "main", template: "main" }],
  input: { source: "input", target: "main" }, routes: { main: [] }, decisionPlans: {}, allowMainReconfiguration: false,
  termination: { agent: "main", condition: "Official complete_project and finish_task accepted", decisionBy: "main", automatic: false },
  resultFormat: { presets: [], custom: "Short sentinel response", none: true }
} });
let sdk, run, lastState;
const events = await fs.open(path.join(output, "events.jsonl"), "wx");
try {
  sdk = await createResearchSdk({ dataDir: path.join(output, "runtime"), ...native });
  run = await sdk.start({ title: "Installed SDK default native OAuth acceptance", requirement: "Validate the installed default API using real native OAuth and formal completion, without unrelated work.",
    workflow, gatewayBindings: { defaultNativeCodexProfileId: "acceptance" } });
  console.log(JSON.stringify({ type: "package.acceptance.started", runId: run.id, runtimeRevision: sdk.runtimeRevision }));
  let sentinel = false;
  for await (const event of run.events({ signal: AbortSignal.timeout(240_000) })) {
    await events.write(JSON.stringify(event) + "\n");
    if (event.data?.canonicalEvent?.kind === "assistant.message" &&
        event.data.canonicalEvent.message?.includes("SCIENCEEVOLVE_INSTALLED_DEFAULT_ACCEPTED")) sentinel = true;
    if (event.seq > 200) throw new Error("Installed acceptance event budget exceeded");
  }
  const state = lastState = await run.snapshot();
  if (state.status !== "completed" || !sentinel) throw new Error("Installed default OAuth completion/sentinel missing");
  const runtimeRevision = sdk.runtimeRevision;
  await sdk.close(); sdk = undefined;
  const unchanged = (await fs.readFile(path.join(home, "config.toml"))).equals(before);
  if (!unchanged) throw new Error("Native config changed during installed acceptance");
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ runtimeRevision, run: state,
    nativeConfigUnchanged: unchanged }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ type: "package.acceptance.passed", runId: run.id, nativeConfigUnchanged: unchanged }));
} catch (error) {
  await run?.cancel().catch(() => {});
  await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error),
    ...(run ? { run: await run.snapshot().catch(() => lastState) } : {}) }, null, 2) + "\n", { flag: "wx" });
  throw error;
} finally { await events.close(); await sdk?.close(); }
