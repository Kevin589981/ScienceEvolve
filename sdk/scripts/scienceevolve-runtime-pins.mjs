import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const runtimePinsVersion = "scienceevolve-runtime-pins-v1";
export const runtimePinsDigest = hash(await readFile(new URL(import.meta.url)));
const prefix = "src/core/harness-runtime/";
const bridge = prefix + "descriptor-broker-mcp.ts";
const authority = prefix + "filesystem-authority.ts";
const helper = prefix + "descriptor-broker-helper.py";
const windowsHelper = prefix + "descriptor-broker-windows.py";
const residentHelper = prefix + "windows-resident-helper.py";
const patchSource = prefix + "windows-apply-patch.cs";
const resident = prefix + "windows-resident.ts";
const patch = prefix + "windows-codex-patch.ts";
const required = [authority, bridge, helper, windowsHelper, residentHelper, patchSource, resident, patch];
const pinnedTypescriptVersion = "5.9.3";

function pinDocument(target, bytes, pins) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error("Invalid executable pin source encoding: " + target);
  const edits = [];
  for (const pin of pins.filter((entry) => entry.target === target)) {
    const matches = [...text.matchAll(new RegExp(`(\\bconst ${pin.constant}\\s*=\\s*")([a-f0-9]{64})(")`, "g"))];
    if (matches.length !== 1) throw new Error("Executable pin declaration drift: " + pin.constant);
    const [match] = matches;
    if (match[2] !== pin.sha256) edits.push({ constant: pin.constant, offset: match.index + match[1].length, before: match[2], after: pin.sha256 });
  }
  edits.sort((a, b) => a.offset - b.offset);
  let output = text;
  for (const edit of edits.toReversed()) output = output.slice(0, edit.offset) + edit.after + output.slice(edit.offset + edit.before.length);
  return { bytes: Buffer.from(output), edits };
}

/** Reverse only declared 64-byte hash edits; the source hash verifies old pins. */
export function unpinBytes(bytes, edits = []) {
  if (!Array.isArray(edits)) throw new Error("Invalid derived executable pin provenance");
  let text = bytes.toString("utf8"), previousEnd = 0;
  if (!Buffer.from(text).equals(bytes)) throw new Error("Invalid executable pin target encoding");
  for (const edit of edits) {
    if (!edit || typeof edit.constant !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(edit.constant) ||
      !Number.isSafeInteger(edit.offset) || edit.offset < previousEnd ||
      !/^[a-f0-9]{64}$/.test(edit.before) || !/^[a-f0-9]{64}$/.test(edit.after) || edit.before === edit.after ||
      text.slice(edit.offset, edit.offset + 64) !== edit.after) throw new Error("Derived executable pin context drift");
    previousEnd = edit.offset + 64;
  }
  for (const edit of edits.toReversed()) text = text.slice(0, edit.offset) + edit.before + text.slice(edit.offset + 64);
  return Buffer.from(text);
}

/** The actual project's compiler host/program performs the same emit as tsc. */
export async function deriveRuntimePins(sdkRoot, sourceBytes) {
  const present = required.filter((relative) => sourceBytes.has(relative));
  const proof = { version: runtimePinsVersion, moduleSha256: runtimePinsDigest, inputs: [], pins: [] };
  if (!present.length) return { proof, outputs: new Map() };
  if (present.length !== required.length) throw new Error("Incomplete executable pin input closure");
  const bytes = new Map(required.map((relative) => [relative, sourceBytes.get(relative)]));
  const pins = [];
  function bind(target, constant, input, sha256 = hash(bytes.get(input))) { pins.push({ target, constant, input, sha256 }); }
  bind(bridge, "EXPECTED_HELPER_SHA256", helper);
  bind(bridge, "EXPECTED_WINDOWS_HELPER_SHA256", windowsHelper);
  const preparedBridge = pinDocument(bridge, bytes.get(bridge), pins);
  bytes.set(bridge, preparedBridge.bytes);

  const { default: ts } = await import("typescript");
  const packageJson = JSON.parse(await readFile(path.join(sdkRoot, "package.json"), "utf8"));
  if (ts.version !== pinnedTypescriptVersion || packageJson.devDependencies?.typescript !== pinnedTypescriptVersion || packageJson.type !== "module")
    throw new Error("Executable pin compiler/package identity drift");
  const configFile = path.join(sdkRoot, "tsconfig.json");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error || config.config.extends) throw new Error("Unsupported executable pin compiler config");
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, sdkRoot);
  if (parsed.errors.length || parsed.options.newLine !== ts.NewLineKind.LineFeed ||
    parsed.options.module !== ts.ModuleKind.NodeNext || parsed.options.target !== ts.ScriptTarget.ES2022)
    throw new Error("Executable pin compiler options drift");
  const compilerPath = createRequire(import.meta.url).resolve("typescript");
  proof.compiler = { version: ts.version, sha256: hash(await readFile(compilerPath)),
    configSha256: hash(JSON.stringify(config.config.compilerOptions)) };
  const bridgeFile = path.join(sdkRoot, bridge);
  const host = ts.createCompilerHost(parsed.options);
  const originalRead = host.readFile.bind(host);
  host.readFile = (file) => path.resolve(file) === path.resolve(bridgeFile) ? bytes.get(bridge).toString("utf8") : originalRead(file);
  const program = ts.createProgram([bridgeFile], parsed.options, host);
  const source = program.getSourceFile(bridgeFile);
  if (!source || program.getSyntacticDiagnostics(source).length) throw new Error("Executable bridge syntax drift");
  let compiled;
  const emitted = program.emit(source, (file, text) => {
    if (file.endsWith("/descriptor-broker-mcp.js") || file.endsWith("\\descriptor-broker-mcp.js")) compiled = Buffer.from(text);
  });
  if (emitted.emitSkipped || !compiled || compiled.includes(Buffer.from("\r\n"))) throw new Error("Executable bridge deterministic emit failed");

  bind(authority, "DESCRIPTOR_BROKER_HELPER_SHA256", helper);
  bind(authority, "DESCRIPTOR_BROKER_WINDOWS_SHA256", windowsHelper);
  bind(authority, "DESCRIPTOR_BROKER_MCP_SHA256", bridge);
  bind(authority, "DESCRIPTOR_BROKER_MCP_COMPILED_SHA256", "dist/core/harness-runtime/descriptor-broker-mcp.js", hash(compiled));
  bind(resident, "WINDOWS_RESIDENT_HELPER_SHA256", residentHelper);
  bind(patch, "SOURCE_SHA256", patchSource);
  proof.inputs = [...bytes].filter(([relative]) => ![authority, resident, patch].includes(relative))
    .map(([relative, value]) => ({ path: relative, sha256: hash(value) })).sort((a, b) => a.path.localeCompare(b.path));
  proof.pins = pins;
  const outputs = new Map([...new Set(pins.map((pin) => pin.target))].map((target) => [target, pinDocument(target, sourceBytes.get(target), pins)]));
  return { proof, outputs, compiledBytes: compiled };
}

export function assertRuntimePinEdits(target, bytes, edits, proof) {
  const replay = pinDocument(target, unpinBytes(bytes, edits), proof.pins);
  if (!replay.bytes.equals(bytes) || JSON.stringify(replay.edits) !== JSON.stringify(edits))
    throw new Error("Derived executable pin replay drift: " + target);
}
