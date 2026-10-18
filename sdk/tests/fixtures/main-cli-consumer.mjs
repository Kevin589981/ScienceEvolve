import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateMainWorkflowConfig } from "@scienceevolve/sdk/main";

// Installed CLI in fresh Node processes, actual main host/SQLite. No probes, model or GitHub requests.
const cli = path.resolve("node_modules/@scienceevolve/sdk/cli/scienceevolve.mjs");
const dataDir = path.resolve("main CLI data ' $(literal)");
const config = path.resolve("main-deployment.json");
const key = "opaque-main-cli-package-fixture-key";
const env = { ...process.env, SCIENCEEVOLVE_MAIN_CLI_PACKAGE_KEY: key,
  SCIENCEEVOLVE_DATA_DIR: path.resolve("must-not-use-legacy-environment-data") };
await writeFile(config, JSON.stringify({ execution: { agentConcurrency: 2 },
  git: { tokenEnv: "SCIENCEEVOLVE_MAIN_CLI_PACKAGE_TOKEN", expectedIdentity: { id: 42, login: "fixture" } } }));
delete env.SCIENCEEVOLVE_MAIN_CLI_PACKAGE_TOKEN;
const common = ["--data-dir", dataDir, "--runtime-config", config];
function invoke(args, flags = common) {
  const output = execFileSync(process.execPath, [cli, ...args, ...flags], { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 });
  assert.ok(!output.includes(key));
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function fails(args, pattern) {
  assert.throws(() => invoke(args, []), (error) => {
    const text = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    assert.ok(!text.includes(key)); assert.match(text, pattern); return true;
  });
}
const help = execFileSync(process.execPath, [cli, "--engine", "main", "--help"], { encoding: "utf8", timeout: 30_000 });
assert.match(execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }), /default main engine/);
assert.match(help, /resumable Stop/); assert.match(help, /NOT offline read-only/);
assert.match(help, /--inputs-file/); assert.match(help, /--input-description/);
const workflowFile = path.resolve("main-cli-workflow.json");
await writeFile(workflowFile, JSON.stringify(validateMainWorkflowConfig({ git: { enabled: true } })));
const valid = invoke(["workflow", "validate", workflowFile], ["--engine", "main"])[0];
assert.equal(valid.engine, "main"); assert.equal(valid.schemaVersion, 3);
await assert.rejects(access(dataDir), { code: "ENOENT" });
fails(["run", "list", "--engine", "main"], /Missing --data-dir/);
fails(["run", "list", "--engine", "main", "--data-dir", "relative"], /absolute dedicated/);
fails(["run", "list", "--engine", "typo"], /Only the main engine/);
const added = invoke(["gateway", "add", "--name", "package fixture", "--url", "https://93.184.216.34/v1", "--protocol", "responses",
  "--models", "fixture", "--default-model", "fixture", "--key-env", "SCIENCEEVOLVE_MAIN_CLI_PACKAGE_KEY"])[0];
assert.equal(added.gateway.apiKeyConfigured, true);
assert.equal(invoke(["gateway", "list"])[0].gateways[0].id, added.gateway.id);
const profile = path.resolve("readonly native profile"); await mkdir(profile);
const nativeConfig = 'model_provider = "fixture"\n[model_providers.fixture]\nbase_url = "https://93.184.216.34/v1"\nwire_api = "responses"\nenv_key = "SCIENCEEVOLVE_MAIN_CLI_PACKAGE_KEY"\n';
await writeFile(path.join(profile, "config.toml"), nativeConfig);
const imported = invoke(["gateway", "import", "--harness", "codex", "--model", "fixture", "--source", "profile", "--profile-path", profile])[0];
assert.equal(imported.type, "gateway.imported"); assert.equal(imported.gateway.apiKeyConfigured, true);
assert.equal(await readFile(path.join(profile, "config.toml"), "utf8"), nativeConfig);
assert.equal(invoke(["harnesses"])[0].harnesses.find((entry) => entry.id === "pi")?.available, true);
assert.deepEqual(invoke(["run", "list"])[0].runs, []);
const marker = await readFile(path.join(dataDir, ".scienceevolve-main-runtime.json"), "utf8");
assert.match(marker, /main-runtime/);
await assert.rejects(access(path.join(dataDir, ".scienceevolve-runtime.lock")), { code: "ENOENT" });
await assert.rejects(access(env.SCIENCEEVOLVE_DATA_DIR), { code: "ENOENT" });
// No binding/workspace fallback and no external model launch.
fails(["start", workflowFile, "not-read.txt", "--engine", "main", "--data-dir", dataDir, "--gateway", added.gateway.id, "--workspace", process.cwd(), "--source-workspace", process.cwd()], /mutually exclusive/);
fails(["start", workflowFile, "not-read.txt", "--engine", "main", "--data-dir", dataDir], /exactly one/);
fails(["start", workflowFile, "not-read.txt", "--engine", "main", "--data-dir", dataDir, "--gateway", added.gateway.id,
  "--inputs", "not-read.png", "--inputs-file", "not-read.json"], /mutually exclusive/);
// Removed engines are rejected before any data access; main preserves nonempty user directories.
fails(["run", "list", "--engine", "legacy", "--data-dir", dataDir], /legacy engine has been removed/);
assert.equal(await readFile(path.join(dataDir, ".scienceevolve-main-runtime.json"), "utf8"), marker);
const otherData = path.resolve("existing user data"); await mkdir(otherData);
await writeFile(path.join(otherData, "preserve.txt"), "preserve me");
fails(["run", "list", "--engine", "main", "--data-dir", otherData], /empty dedicated/);
assert.equal(await readFile(path.join(otherData, "preserve.txt"), "utf8"), "preserve me");
assert.deepEqual(invoke(["run", "list"])[0].runs, []);
console.log(JSON.stringify({ cli: "main", actualSqlite: true, separateProcesses: true, gatewayRedaction: true,
  managedPi: true, explicitEngineAndDirectory: true, defaultMainValidated: true, legacyRejected: true,
  workflowV3: true, workspaceNotSilentlyImported: true, realModel: false, realGitHub: false }));
