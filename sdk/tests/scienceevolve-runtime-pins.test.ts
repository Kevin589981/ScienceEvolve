import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveRuntimePins, unpinBytes, assertRuntimePinEdits } from "../scripts/scienceevolve-runtime-pins.mjs";
import { unbrandBytes } from "../scripts/scienceevolve-branding.mjs";
import { applySharedFixes } from "../scripts/main-runtime-fixes.mjs";

const sdk = fileURLToPath(new URL("../", import.meta.url));
const authorityTarget = "src/core/harness-runtime/filesystem-authority.ts";
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const manifest = JSON.parse(await fs.readFile(path.join(sdk, "resources/main-runtime/manifest.json"), "utf8"));
  const bytes = new Map(await Promise.all(manifest.files.map(async entry => [entry.target, await fs.readFile(path.join(sdk, entry.target))])));
  return { manifest, bytes };
}

describe("derived executable build pins", () => {
  it("binds every helper and bridge pin to exact inputs and the pinned compiler program emit", async () => {
    const { manifest, bytes } = await fixture();
    const derived = await deriveRuntimePins(sdk, bytes);
    expect(derived.proof).toEqual(manifest.runtimePins);
    const compiledPin = derived.proof.pins.find(pin => pin.constant === "DESCRIPTOR_BROKER_MCP_COMPILED_SHA256");
    expect(digest(derived.compiledBytes)).toBe(compiledPin.sha256);
    for (const [target, result] of derived.outputs) expect(result.bytes).toEqual(bytes.get(target));
    const entry = manifest.files.find(item => item.target === authorityTarget);
    const original = applySharedFixes(entry.source, unbrandBytes(unpinBytes(bytes.get(authorityTarget), entry.derivedPinEdits), entry.brandingEdits), true, entry.sharedFixes);
    expect(digest(original)).toBe(entry.sourceSha256);
  });

  it("rejects changed executable pins, changed contexts and altered derivation proofs", async () => {
    const { manifest, bytes } = await fixture();
    const entry = manifest.files.find(item => item.target === authorityTarget);
    // A freshly branded upstream can already contain the exact derived pins.
    // Exercise edit validation with one explicit synthetic prior pin instead
    // of assuming the current source needs an overlay.
    const pin = manifest.runtimePins.pins.find(item => item.target === authorityTarget && item.constant === "DESCRIPTOR_BROKER_MCP_SHA256");
    const offset = bytes.get(authorityTarget).toString().indexOf(`"${pin.sha256}"`) + 1;
    expect(offset).toBeGreaterThan(0);
    const edits = [{ constant: pin.constant, offset, before: "0".repeat(64), after: pin.sha256 }];
    const shifted = structuredClone(edits); shifted[0].offset++;
    expect(() => unpinBytes(bytes.get(authorityTarget), shifted)).toThrow(/context drift/);
    const changed = Buffer.from(bytes.get(authorityTarget)); changed[offset] = 120;
    expect(() => unpinBytes(changed, edits)).toThrow(/context drift/);
    const proof = structuredClone(manifest.runtimePins);
    proof.pins.find(pin => pin.constant === "DESCRIPTOR_BROKER_MCP_SHA256").sha256 = "0".repeat(64);
    expect(() => assertRuntimePinEdits(authorityTarget, bytes.get(authorityTarget), entry.derivedPinEdits ?? [], proof)).toThrow(/replay drift/);
    const helper = "src/core/harness-runtime/descriptor-broker-helper.py";
    bytes.set(helper, Buffer.concat([bytes.get(helper), Buffer.from("\n# altered executable\n")]));
    expect((await deriveRuntimePins(sdk, bytes)).proof).not.toEqual(manifest.runtimePins);
  });

  it("requires the exact compiler identity and portable LF configuration", async () => {
    const { bytes } = await fixture();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-build-pins-")); temporary.push(root);
    const packageJson = JSON.parse(await fs.readFile(path.join(sdk, "package.json"), "utf8"));
    const config = JSON.parse(await fs.readFile(path.join(sdk, "tsconfig.json"), "utf8"));
    packageJson.devDependencies.typescript = "^5.9.3";
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
    await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify(config));
    await expect(deriveRuntimePins(root, bytes)).rejects.toThrow(/compiler\/package identity drift/);
    packageJson.devDependencies.typescript = "5.9.3";
    config.compilerOptions.newLine = "crlf";
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(packageJson));
    await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify(config));
    await expect(deriveRuntimePins(root, bytes)).rejects.toThrow(/compiler options drift/);
  });
});
