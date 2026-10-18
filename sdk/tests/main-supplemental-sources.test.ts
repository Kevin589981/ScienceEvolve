import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { brandBytes, brandingDigest, brandingVersion } from "../scripts/scienceevolve-branding.mjs";
import { runtimePinsDigest, runtimePinsVersion } from "../scripts/scienceevolve-runtime-pins.mjs";

const sdk = fileURLToPath(new URL("../", import.meta.url));
const { sourceCommit: baseline } = JSON.parse(await fs.readFile(path.join(sdk, "resources/main-runtime/manifest.json"), "utf8"));
const upstreamCommit = "764257b3db49ebbcf6b08746278120adbe66a95e";
const source = "server/src/network-proxy.ts";
const target = "src/core/network-proxy.ts";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5 })));
});
function revision(files: { source: string; sha256: string }[]) {
  const entries = files.map(({ source, sha256 }) => ({ source, sha256 })).sort((a, b) => a.source.localeCompare(b.source));
  return baseline + "+" + hash(JSON.stringify(entries)).slice(0, 16);
}
async function fixture(content = "export const experiment = true;\n", installedContent = content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sdk-supplemental-"));
  temporary.push(root);
  await Promise.all(["scripts", "resources/main-runtime", "src/core"].map((dir) => fs.mkdir(path.join(root, dir), { recursive: true })));
  await Promise.all(["sync-main-runtime.mjs", "main-runtime-fixes.mjs", "scienceevolve-branding.mjs", "scienceevolve-runtime-pins.mjs"].map((name) => fs.copyFile(path.join(sdk, "scripts", name), path.join(root, "scripts", name))));
  const originalManifest = JSON.parse(await fs.readFile(path.join(sdk, "resources/main-runtime/manifest.json"), "utf8"));
  const original = "export const original = true;\n";
  const entry = { source: "server/src/original.ts", target: "src/core/original.ts", sourceSha256: hash(original), sharedFixes: [], brandingEdits: [], sha256: hash(original) };
  const index: any = { schemaVersion: 1, sourceCommit: baseline, fixes: [],
    supplementalSources: [{ source, upstreamCommit, sourceSha256: hash(content) }] };
  const indexFile = path.join(root, "resources/main-runtime/shared-fixes.json");
  const manifestFile = path.join(root, "resources/main-runtime/manifest.json");
  const manifest: any = { schemaVersion: 2, sourceCommit: baseline, roots: originalManifest.roots,
    brandingVersion, brandingSha256: brandingDigest,
    runtimePins: { version: runtimePinsVersion, moduleSha256: runtimePinsDigest, inputs: [], pins: [] },
    sharedFixesSha256: hash(JSON.stringify(index)), runtimeRevision: revision([entry]), files: [entry] };
  await Promise.all([
    fs.writeFile(indexFile, JSON.stringify(index)), fs.writeFile(manifestFile, JSON.stringify(manifest)),
    fs.writeFile(path.join(root, entry.target), original), fs.writeFile(path.join(root, target), installedContent)
  ]);
  const run = (arg = "--refresh-host-extensions", ...args: string[]) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/sync-main-runtime.mjs"), arg, ...args], { encoding: "utf8" });
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { root, index, indexFile, manifest, manifestFile, run };
}

describe("supplemental main source provenance", () => {
  it("refreshes a declared host fix in an existing source without requiring Git history", async () => {
    const f = await fixture();
    f.index.fixes = [{ id: "sdk-host-existing-fixture", source: "server/src/original.ts", hostOnly: true,
      replacements: [{ before: "export const original = true;", after: "export const original = false;" }] }];
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    await fs.writeFile(path.join(f.root, "src/core/original.ts"), "export const original = false;\n");
    const result = f.run(); expect(result, result.output).toMatchObject({ status: 0 });
    const entry = JSON.parse(await fs.readFile(f.manifestFile, "utf8")).files.find(entry => entry.source === "server/src/original.ts");
    expect(entry.sharedFixes).toEqual(["sdk-host-existing-fixture"]);
    expect(entry.sourceSha256).toBe(hash("export const original = true;\n"));
    expect(f.run("--check")).toMatchObject({ status: 0 });
  });

  it("verifies a declared branded source without an upstream checkout and keeps its original identity", async () => {
    const namingRules = await fs.readFile(path.join(sdk, "scripts/scienceevolve-branding.mjs"), "utf8");
    const legacyToken = namingRules.match(/\["([^"]+)", "ScienceEvolve"\]/)![1];
    const original = `export const importedName = ${JSON.stringify(legacyToken)};\n`;
    const branded = brandBytes(Buffer.from(original));
    const f = await fixture(original, branded.bytes.toString());
    f.index.supplementalSources[0].brandingEdits = branded.edits;
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    const result = f.run(); expect(result, result.output).toMatchObject({ status: 0 });
    const entry = JSON.parse(await fs.readFile(f.manifestFile, "utf8")).files.find(entry => entry.source === source);
    expect(entry.sourceSha256).toBe(hash(original));
    expect(entry.brandingEdits).toEqual(branded.edits);
    expect(f.run("--check")).toMatchObject({ status: 0 });
  });

  it("rejects a changed branding declaration without persisting an imported source", async () => {
    const namingRules = await fs.readFile(path.join(sdk, "scripts/scienceevolve-branding.mjs"), "utf8");
    const legacyToken = namingRules.match(/\["([^"]+)", "ScienceEvolve"\]/)![1];
    const original = `export const importedName = ${JSON.stringify(legacyToken)};\n`;
    const branded = brandBytes(Buffer.from(original));
    const f = await fixture(original, branded.bytes.toString());
    const edits = structuredClone(branded.edits); edits[0].offset++;
    f.index.supplementalSources[0].brandingEdits = edits;
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    const before = await fs.readFile(f.manifestFile, "utf8");
    expect(f.run().output).toContain("Runtime branding context drift");
    expect(await fs.readFile(f.manifestFile, "utf8")).toBe(before);
  });

  it("appends pinned sources and checks them without an upstream checkout", async () => {
    const f = await fixture();
    expect(f.run()).toMatchObject({ status: 0 });
    const manifest = JSON.parse(await fs.readFile(f.manifestFile, "utf8"));
    expect(manifest.sourceCommit).toBe(baseline);
    expect(manifest.files.find((entry: any) => entry.source === source)).toMatchObject(f.index.supplementalSources[0]);
    expect(f.run("--check")).toMatchObject({ status: 0 });
  });

  it("requires a declaration and leaves the manifest intact on rejection", async () => {
    const f = await fixture();
    delete f.index.supplementalSources;
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    const before = await fs.readFile(f.manifestFile, "utf8");
    expect(f.run().output).toContain("Unmanifested runtime file");
    expect(await fs.readFile(f.manifestFile, "utf8")).toBe(before);
  });

  it("rejects a declaration with the wrong original hash", async () => {
    const f = await fixture();
    f.index.supplementalSources[0].sourceSha256 = "0".repeat(64);
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    expect(f.run().output).toContain("Supplemental source drift");
  });

  it("compares a supplemental declaration with its actual Git blob during extraction", async () => {
    const f = await fixture();
    const checkout = path.join(f.root, "upstream");
    await fs.mkdir(path.join(checkout, "server/src"), { recursive: true });
    const git = (...args: string[]) => execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", windowsHide: true });
    git("init", "-q"); git("config", "user.name", "Supplemental fixture");
    git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
    await fs.writeFile(path.join(checkout, source), "export const upstream = true;\n");
    git("add", "."); git("commit", "-qm", "Supplemental source");
    f.index.supplementalSources[0].upstreamCommit = git("rev-parse", "HEAD").trim();
    await fs.unlink(path.join(checkout, source));
    await fs.writeFile(path.join(checkout, "server/src/original.ts"), "export const original = true;\n");
    git("add", "-A"); git("commit", "-qm", "Baseline without supplemental source");
    const commit = git("rev-parse", "HEAD").trim();
    f.index.sourceCommit = commit;
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    const script = path.join(f.root, "scripts/sync-main-runtime.mjs");
    await fs.writeFile(script, (await fs.readFile(script, "utf8")).replace(
      /const sourceCommit = "[a-f0-9]{40}";/, `const sourceCommit = "${commit}";`));
    // Real Git history created by this test: the declared source hash differs
    // from the actual supplemental blob. Reject before writing any sources.
    await fs.unlink(f.manifestFile);
    const result = f.run("--source", checkout);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Supplemental Git source drift");
    await expect(fs.access(f.manifestFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a changed upstream commit in an otherwise self-consistent manifest", async () => {
    const f = await fixture();
    expect(f.run().status).toBe(0);
    const manifest = JSON.parse(await fs.readFile(f.manifestFile, "utf8"));
    manifest.files.find((entry: any) => entry.source === source).upstreamCommit = "a".repeat(40);
    await fs.writeFile(f.manifestFile, JSON.stringify(manifest));
    expect(f.run("--check").output).toContain("Unexpected supplemental source identity");
  });

  it.each(["import 'express';\n", "import router from 'express/lib/router.js';\n"])("rejects Express dependencies before persisting: %s", async (content) => {
    const f = await fixture(content);
    const before = await fs.readFile(f.manifestFile, "utf8");
    expect(f.run().output).toContain("Express runtime dependency");
    expect(await fs.readFile(f.manifestFile, "utf8")).toBe(before);
  });

  it("rejects missing supplemental dependencies", async () => {
    const f = await fixture("import './missing.js';\n");
    expect(f.run().output).toContain("Unresolved supplemental dependency");
  });

  it("checks existing file drift before appending a supplemental source", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, "src/core/original.ts"), "changed");
    expect(f.run().output).toContain("Unrelated source drift");
    expect(JSON.parse(await fs.readFile(f.manifestFile, "utf8")).files).toHaveLength(1);
  });

  it("reverses declared host fixes to the pinned supplemental source", async () => {
    const original = "export const experiment = true;\n";
    const patched = "export const experiment = false;\n";
    const f = await fixture(original);
    f.index.fixes.push({ id: "portable-experiment", source, hostOnly: true, replacements: [{ before: original, after: patched }] });
    await fs.writeFile(f.indexFile, JSON.stringify(f.index));
    await fs.writeFile(path.join(f.root, target), patched);
    expect(f.run().status).toBe(0);
    expect(f.run("--check").status).toBe(0);
    await fs.writeFile(path.join(f.root, target), patched + "// drift");
    expect(f.run("--check").output).toContain("Main source drift");
  });
});
