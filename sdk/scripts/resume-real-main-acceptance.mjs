// Resume only our own explicitly authorized acceptance, on the exact original
// runtime revision. No marker upgrades, policy bypasses or model simulation.
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createMainResearchSdk } from "../dist/main.js";

const [root, runId, home, deliveryName = "delivery"] = process.argv.slice(2);
if (!path.isAbsolute(root ?? "") || !/^sdk-acceptance-git-evolver-\d{8}-[a-z]+$/.test(path.basename(root)) ||
    !/^prj_[a-f0-9]{32}$/.test(runId ?? "") || !path.isAbsolute(home ?? "") ||
    !/^delivery(?:-[a-z]+)?$/.test(deliveryName)) throw new Error("Explicit acceptance root, run ID, native home and safe delivery name required");
const before = await fs.readFile(path.join(home, "config.toml"));
const options = { dataDir: path.join(root, "runtime"), nativeCodexProfiles: { acceptance: home },
  timeouts: { residentModelInactivityTimeoutMs: 120_000, residentToolInactivityTimeoutMs: 120_000 },
  execution: { retryBaseMs: 1_000, retryMaxMs: 2_000 },
  git: { expectedIdentity: JSON.parse(execFileSync("gh", ["api", "user", "--jq", "{login: .login, id: .id}"], { encoding: "utf8" })),
    credentialResolver: async (signal) => { signal?.throwIfAborted(); return {
      token: execFileSync("gh", ["auth", "token", "--hostname", "github.com"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), requestedScopes: ["repo"]
    }; }
  }
};
let sdk = await createMainResearchSdk(options), run, evolutionEvent;
const log = await fs.open(path.join(root, "resumed-events.jsonl"), "wx");
try {
  run = await sdk.getRun(runId);
  const initial = await run.snapshot();
  console.log(JSON.stringify({ type: "acceptance.recovery", runId, status: initial.status, runtimeRevision: sdk.runtimeRevision }));
  if (initial.status === "paused") await run.resume();
  for await (const event of run.events({ signal: AbortSignal.timeout(600_000) })) {
    await log.write(JSON.stringify(event) + "\n");
    if (event.type === "workflow.reconfigured" && event.data?.sourceType === "scoped.configuration.applied") evolutionEvent = event;
    if (!/trace/.test(event.type)) console.log(JSON.stringify({ seq: event.seq, type: event.type, message: event.message }));
    if (event.seq > 1200) throw new Error("Recovery event budget exceeded");
  }
  const state = await run.snapshot();
  if (state.status !== "completed") throw new Error(`Recovery not completed: ${state.status} ${state.lastError ?? ""}`);
  const delivery = await run.exportWorkspace({ destination: path.join(root, deliveryName) });
  for (const name of ["sum.py", "test_sum.py", "acceptance.md", "review.md"]) await fs.access(path.join(delivery.destination, name));
  const evolved = evolutionEvent?.data?.configuration?.agents;
  if (evolutionEvent?.workflowRevision !== state.workflowRevision || state.workflowRevision <= 1 ||
      !evolved?.main?.instructions?.endsWith("SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1") ||
      !evolved?.execution?.instructions?.endsWith("Write acceptance.md containing SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1") ||
      !(await fs.readFile(path.join(delivery.destination, "acceptance.md"), "utf8")).includes("SCIENCEEVOLVE_EVOLVED_ACCEPTED_V1")) throw new Error("Formal evolution proof missing");
  const tests = spawnSync("python", ["-m", "unittest", "-v"], { cwd: delivery.destination, encoding: "utf8", timeout: 30_000 });
  await fs.writeFile(path.join(root, "host-test-result.json"), JSON.stringify({ status: tests.status, stdout: tests.stdout, stderr: tests.stderr }, null, 2), { flag: "wx" });
  if (tests.error || tests.status !== 0) throw new Error(`Exported tests failed: ${tests.error ?? tests.stderr}`);
  console.log(JSON.stringify({ type: "acceptance.delivery", delivery }));
  await fs.writeFile(path.join(root, "resumed-result.json"), JSON.stringify({ state, delivery,
    nativeConfigUnchanged: (await fs.readFile(path.join(home, "config.toml"))).equals(before), runtimeRevision: sdk.runtimeRevision }, null, 2), { flag: "wx" });
  await sdk.close(); sdk = await createMainResearchSdk(options);
  const recovered = await (await sdk.getRun(runId)).snapshot();
  if (recovered.status !== "completed") throw new Error("Completed work restarted on reopen");
  await fs.writeFile(path.join(root, "reopened.json"), JSON.stringify(recovered, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ type: "acceptance.passed", runId, recovery: true }));
} finally { await log.close(); await sdk.close(); }
