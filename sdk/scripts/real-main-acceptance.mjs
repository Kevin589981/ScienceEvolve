// Explicit opt-in acceptance. Real model calls and (Git mode) a new private repository.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
const [mode, outputRoot, profileHome, model = "gpt-6.1-sol", consumer] = process.argv.slice(2);
if (!["oauth", "git-evolver"].includes(mode) || !path.isAbsolute(outputRoot ?? "") || !path.isAbsolute(profileHome ?? "") ||
    (consumer !== undefined && !path.isAbsolute(consumer))) {
  throw new Error("Usage: node real-main-acceptance.mjs oauth|git-evolver ABS_NEW_OUTPUT_ROOT ABS_CODEX_HOME [MODEL] [ABS_INSTALLED_CONSUMER]");
}
const sdkEntry = consumer ? execFileSync(process.execPath,
  ["--input-type=module", "-e", 'process.stdout.write(import.meta.resolve("@scienceevolve/sdk"))'], { cwd: consumer, encoding: "utf8" }).trim()
  : new URL("../dist/main.js", import.meta.url).href;
const exports = await import(sdkEntry);
const createMainResearchSdk = consumer ? exports.createResearchSdk : exports.createMainResearchSdk;
const validateMainWorkflowConfig = consumer ? exports.validateWorkflowConfig : exports.validateMainWorkflowConfig;
const { HarnessRuntimeFacade } = await import(new URL("./core/harness-runtime/runtime.js", sdkEntry).href);
const { redactTrace } = await import(new URL("./core/utils.js", sdkEntry).href);

// Diagnostic-only tap: keep the real process/route/control implementation intact.
const nativeRun = HarnessRuntimeFacade.prototype.run;
HarnessRuntimeFacade.prototype.run = async function (...args) {
  try { return await nativeRun.apply(this, args); } catch (error) {
    const causes = []; for (let current = error; current && causes.length < 5; current = current.cause) causes.push(redactTrace(`${current.name}: ${current.message}`));
    console.error(JSON.stringify({ type: "acceptance.native.error", causes })); throw error;
  }
};

await fs.mkdir(outputRoot, { recursive: false });
const configBefore = await fs.readFile(path.join(profileHome, "config.toml"));
const git = mode === "git-evolver";
const repositoryName = `scienceevolve-sdk-acceptance-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Date.now().toString(36)}`;
const identity = git ? JSON.parse(execFileSync("gh", ["api", "user", "--jq", "{login: .login, id: .id}"], { encoding: "utf8" })) : undefined;
const sdkOptions = { dataDir: path.join(outputRoot, "runtime"), nativeCodexProfiles: { acceptance: profileHome },
  timeouts: { residentModelInactivityTimeoutMs: 120_000, residentToolInactivityTimeoutMs: 120_000 },
  execution: { retryBaseMs: 1_000, retryMaxMs: 2_000 },
  ...(git ? { git: { expectedIdentity: identity, credentialResolver: async (signal) => {
    signal?.throwIfAborted();
    const token = execFileSync("gh", ["auth", "token", "--hostname", "github.com"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return { token, requestedScopes: ["repo"] };
  } } } : {})
};
let sdk = await createMainResearchSdk(sdkOptions);
const mainInstructions = git
  ? `This is a bounded SDK Git-on Evolver acceptance, not an open-ended research project. Before planning business work, inspect the supplied Writable workflow proposal using its opaque filesystem root. If agents.main.instructions does not end in the exact standalone line SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1, edit only agents.main.instructions to append that line and agents.execution.instructions to append 'Write acceptance.md containing SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1'. Mentioning the marker earlier in this editing instruction is not the required final suffix. Apply the proposal using the authorized control tool and finish_task before dispatching business work. Do this evolution once, never again. Once the exact final suffix is present, assign the implementation and independent review tasks normally. Each management round needs finish_task plus its formal planning/routing/completion action. After all member deliveries and the final group PR have been merged, complete_group using the supplied authoritative final integration facts. The acceptance host will run the Python tests on the exported integrated main: do not claim shell execution evidence in this read-only native sandbox. Do not reconfigure routes or add Agents. Do not access anything outside the project's supplied paths, native login data, network services, or other repositories.`
  : "Native OAuth acceptance: produce a short final response containing SCIENCEEVOLVE_NATIVE_OAUTH_ACCEPTED. Use the authorized complete_project tool to mark this single-Agent project complete. No shell, external services, file reads beyond the supplied inputs, or other Agents are needed.";
const agent = (instructions = "") => ({ harness: "codex", model, skills: [], autoSkills: [], permission: "workspace", instructions });
let definition;
if (git) {
  definition = JSON.parse(await fs.readFile(new URL("../examples/main-runtime/workflow.json", import.meta.url), "utf8"));
  definition.git = { enabled: true, repositoryName, repositoryVisibility: "private" };
  definition.agents = {
    main: agent(mainInstructions),
    execution: agent("Create sum.py exposing add(a,b), test_sum.py with exactly three unittest cases including negative integers, and acceptance.md. Use supplied filesystem and Git tools, not raw shell (the native sandbox is read-only). The host will run python -m unittest -v on the final export; record the command but do not claim it already ran. Use the authorized submission tools to commit/push/open a PR, then finish your task. Work only in supplied project paths; do not use other repositories or network services."),
    review: agent("Independently inspect the supplied execution delivery sum.py and test_sum.py; write review.md with a factual static audit and the reproducible command python -m unittest -v. If a defect exists fix it. Do not claim to run shell in the native read-only sandbox: the host will execute tests on the integrated export. Use authorized submission tools and finish your task. Work only in supplied project paths.")
  };
  definition.orchestration.allowMainReconfiguration = true;
  definition.orchestration.scopedWorkflow.groups[0].allowLeaderReconfiguration = true;
  definition.orchestration.resultFormat = { presets: ["code", "markdown"], custom: "sum.py, test_sum.py, acceptance.md and review.md with reproducible passing unittest evidence." };
} else definition = { git: { enabled: false }, agents: { main: agent(mainInstructions) }, orchestration: {
  schemaVersion: 2, collaborations: [], agents: [{ name: "main", template: "main" }], input: { source: "input", target: "main" },
  routes: { main: [] }, decisionPlans: {}, allowMainReconfiguration: false,
  termination: { agent: "main", condition: "Native OAuth response and official control completion observed", decisionBy: "main", automatic: false },
  resultFormat: { presets: [], custom: "Short acceptance response", none: true }
} };
const workflow = validateMainWorkflowConfig(definition);
await fs.writeFile(path.join(outputRoot, "workflow.json"), JSON.stringify(workflow, null, 2) + "\n", { flag: "wx" });
let run, lastState, evolutionEvent;
const startedAt = new Date().toISOString();
const log = await fs.open(path.join(outputRoot, "events.jsonl"), "wx");
try {
  run = await sdk.start({ title: `SDK real ${mode} acceptance`, requirement: git
    ? "Perform one authorized workflow prompt evolution, implement and independently review a tiny Python addition module, merge all deliveries and formally complete. Every required file and unittest evidence must be present in integrated main."
    : "Validate native Codex OAuth and official complete_project control on this bounded single-Agent task. Do not access credentials or perform unrelated work.",
    workflow, gatewayBindings: { defaultNativeCodexProfileId: "acceptance" } });
  console.log(JSON.stringify({ type: "acceptance.started", mode, runId: run.id, runtimeRevision: sdk.runtimeRevision, installedPackage: Boolean(consumer), ...(git ? { repositoryName, owner: identity.login } : {}) }));
  const signal = AbortSignal.timeout(git ? 900_000 : 240_000);
  for await (const event of run.events({ signal })) {
    await log.write(JSON.stringify(event) + "\n");
    if (event.type === "workflow.reconfigured" && event.data?.sourceType === "scoped.configuration.applied") evolutionEvent = event;
    if (!/trace/.test(event.type) || /Starting|failed|error|completed|native|reconfig/i.test(event.message ?? "")) console.log(JSON.stringify({ seq: event.seq, type: event.type, message: event.message?.slice(0, 700) }));
    if (event.seq > 1500) throw new Error("Acceptance event budget exceeded; Stop before unbounded model work");
  }
  lastState = await run.snapshot();
  await fs.writeFile(path.join(outputRoot, "result.json"), JSON.stringify({ startedAt, completedAt: new Date().toISOString(), mode, model,
    runtimeRevision: sdk.runtimeRevision, installedPackage: Boolean(consumer),
    run: lastState, nativeConfigUnchanged: (await fs.readFile(path.join(profileHome, "config.toml"))).equals(configBefore) }, null, 2) + "\n");
  if (lastState.status !== "completed") throw new Error(`Acceptance not completed: ${lastState.status} ${lastState.lastError ?? ""}`);
  if (!(await fs.readFile(path.join(profileHome, "config.toml"))).equals(configBefore)) throw new Error("Native profile config changed");
  if (git) {
    const delivery = await run.exportWorkspace({ destination: path.join(outputRoot, "delivery") });
    await fs.writeFile(path.join(outputRoot, "delivery.json"), JSON.stringify(delivery, null, 2) + "\n", { flag: "wx" });
    for (const name of ["sum.py", "test_sum.py", "acceptance.md", "review.md"]) await fs.access(path.join(delivery.destination, name));
    if (!(await fs.readFile(path.join(delivery.destination, "acceptance.md"), "utf8")).includes("SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1")) throw new Error("Evolved marker missing from final integrated delivery");
    // Public snapshots deliberately exclude deployment Agent configuration.
    // Use the formal, persisted configuration event, not an invented snapshot field
    // or the marker mentioned in the initial prompt's editing instructions.
    const evolved = evolutionEvent?.data?.configuration?.agents;
    if (evolutionEvent?.workflowRevision !== lastState.workflowRevision || lastState.workflowRevision <= 1 ||
        !evolved?.main?.instructions?.endsWith("SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1") ||
        !evolved?.execution?.instructions?.endsWith("Write acceptance.md containing SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1")) throw new Error("Formal prompt evolution did not persist");
    const tests = spawnSync("python", ["-m", "unittest", "-v"], { cwd: delivery.destination, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
    await fs.writeFile(path.join(outputRoot, "host-test-result.json"), JSON.stringify({ status: tests.status, stdout: tests.stdout, stderr: tests.stderr }, null, 2), { flag: "wx" });
    if (tests.error || tests.status !== 0) throw new Error(`Exported Python tests failed: ${tests.error ?? tests.stderr}`);
    console.log(JSON.stringify({ type: "acceptance.delivery", delivery }));
  }
  await sdk.close();
  sdk = await createMainResearchSdk(sdkOptions);
  const recovered = await (await sdk.getRun(run.id)).snapshot();
  if (recovered.status !== "completed") throw new Error("Completed run did not remain completed on reopen");
  await fs.writeFile(path.join(outputRoot, "reopened.json"), JSON.stringify(recovered, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ type: "acceptance.passed", mode, runId: run.id }));
} catch (error) {
  if (run) { await run.cancel().catch(() => {}); lastState = await run.snapshot(); }
  await fs.writeFile(path.join(outputRoot, "failure.json"), JSON.stringify({ mode, error: String(error), run: lastState }, null, 2) + "\n");
  throw error;
} finally { await log.close(); await sdk.close(); }
