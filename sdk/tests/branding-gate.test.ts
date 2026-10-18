import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// The gate is a delivery script, deliberately independent of the TypeScript build.
// @ts-expect-error JavaScript module has no ambient declaration.
import { scanBranding } from "../scripts/check-branding.mjs";

const retired = "scion";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const gatePath = fileURLToPath(new URL("../scripts/check-branding.mjs", import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  await Promise.all(temporary.splice(0).map((root) => {
    if (!path.resolve(root).startsWith(temporaryRoot) || !path.basename(root).startsWith("scienceevolve-branding-")) {
      throw new Error("Branding test cleanup escaped its generated temporary directory");
    }
    return rm(root, { recursive: true, force: true });
  }));
});

async function fixture(repository = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scienceevolve-branding-"));
  temporary.push(root);
  const exceptionsFile = path.join(root, "allowed.json");
  await writeFile(exceptionsFile, JSON.stringify({ schemaVersion: 1, exceptions: [] }));
  if (repository) execFileSync("git", ["init", "-q", root]);
  return { root, exceptionsFile, scan: () => scanBranding({ ...(repository ? { root } : { packageRoot: root }), exceptionsFile }) };
}

describe("delivery branding gate", () => {
  it("finds delivery paths, separated variants, escaped JSON, UTF-16, and non-text bytes", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, retired + "-old.txt"), "ScienceEvolve");
    await writeFile(path.join(f.root, "separated.txt"), [...retired.toUpperCase()].join("_"));
    await writeFile(path.join(f.root, "escaped.json"), '{"label":"\\u0073' + retired.slice(1) + '"}');
    await writeFile(path.join(f.root, "wide.txt"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(retired, "utf16le")]));
    await writeFile(path.join(f.root, "wide-be.txt"), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(retired, "utf16le").swap16()]));
    await writeFile(path.join(f.root, "wide-bomless.txt"), Buffer.from(retired, "utf16le"));
    await writeFile(path.join(f.root, "binary.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(retired)]));
    const report = await f.scan();
    expect(report.ok).toBe(false);
    expect(report.findings.some((finding: { category: string }) => finding.category === "path")).toBe(true);
    expect(report.findings.some((finding: { selector: { pointer?: string } }) => finding.selector.pointer === "/label")).toBe(true);
    expect(report.files.find((file: { path: string }) => file.path === "wide.txt").encoding).toBe("utf-16le");
    expect(report.files.find((file: { path: string }) => file.path === "wide-be.txt").encoding).toBe("utf-16be");
    expect(report.files.find((file: { path: string }) => file.path === "wide-bomless.txt").encoding).toBe("utf-16le");
    expect(report.binaryFiles.map((file: { path: string }) => file.path)).toEqual(["binary.bin"]);
  });

  it("allows exact historical evidence but rejects added occurrences and stale evidence", async () => {
    const f = await fixture();
    const evidence = "Historical name: " + retired;
    await writeFile(path.join(f.root, "evidence.json"), JSON.stringify({ original: evidence, current: "ScienceEvolve" }));
    await writeFile(f.exceptionsFile, JSON.stringify({ schemaVersion: 1, exceptions: [{
      id: "retained-source", path: "evidence.json", packagePath: "evidence.json",
      selector: { kind: "json-pointer", pointer: "/original" }, contentSha256: digest(evidence), expectedMatches: 1,
      reason: "Exact pinned historical source evidence"
    }] }));
    expect((await f.scan()).ok).toBe(true);
    await writeFile(path.join(f.root, "evidence.json"), JSON.stringify({ original: evidence, current: retired }));
    const added = await f.scan();
    expect(added.ok).toBe(false);
    expect(added.coverage.unexplainedMatches).toBe(1);
    await writeFile(path.join(f.root, "evidence.json"), JSON.stringify({ original: "ScienceEvolve" }));
    const removed = await f.scan();
    expect(removed.ok).toBe(false);
    expect(removed.staleExceptions).toEqual([{ id: "retained-source", path: "evidence.json", expectedMatches: 1, actualMatches: 0 }]);
  });

  it("scans tracked, untracked delivery files and ignored generated output, respecting unrelated ignores", async () => {
    const f = await fixture(true);
    await writeFile(path.join(f.root, ".gitignore"), "ignored/\nsdk/\n");
    await writeFile(path.join(f.root, "tracked.txt"), "ScienceEvolve");
    execFileSync("git", ["-C", f.root, "add", "tracked.txt", ".gitignore"]);
    await mkdir(path.join(f.root, "ignored"));
    await writeFile(path.join(f.root, "ignored", "external.txt"), retired);
    await mkdir(path.join(f.root, "sdk", "dist"), { recursive: true });
    await writeFile(path.join(f.root, "sdk", "dist", "index.js"), retired);
    await mkdir(path.join(f.root, "sdk", "scripts"), { recursive: true });
    await writeFile(path.join(f.root, "sdk", "scripts", "new.js"), retired);
    await writeFile(path.join(f.root, "new.txt"), retired);
    const report = await f.scan();
    expect(report.coverage.generatedFiles).toBe(1);
    expect(report.coverage.unexplainedMatches).toBe(3);
    expect(report.files.some((file: { path: string }) => file.path === "ignored/external.txt")).toBe(false);
    expect(report.files.find((file: { path: string }) => file.path === "new.txt").origins).toContain("untracked-delivery");
    expect(report.files.find((file: { path: string }) => file.path === "sdk/scripts/new.js").origins).toContain("owned-source");
  });

  it("rejects an occurrence-count change even when the exact retained line is unchanged", async () => {
    const f = await fixture();
    const evidence = "Upstream source: " + retired;
    await writeFile(path.join(f.root, "history.txt"), evidence + "\n");
    await writeFile(f.exceptionsFile, JSON.stringify({ schemaVersion: 1, exceptions: [{
      id: "retained-line", path: "history.txt", packagePath: "history.txt",
      selector: { kind: "line", sha256: digest(evidence) }, contentSha256: digest(evidence), expectedMatches: 1,
      reason: "Exact pinned source line"
    }] }));
    expect((await f.scan()).ok).toBe(true);
    await writeFile(path.join(f.root, "history.txt"), evidence + "\n" + evidence + "\n");
    const report = await f.scan();
    expect(report.ok).toBe(false);
    expect(report.staleExceptions[0]).toMatchObject({ expectedMatches: 1, actualMatches: 2 });
  });

  it("pins a historical inventory field without allowing later additions or adjacent current content", async () => {
    const f = await fixture();
    const historical = [{ before: retired, after: "ScienceEvolve" }];
    await writeFile(path.join(f.root, "inventory.json"), JSON.stringify({ historical, current: "ScienceEvolve" }));
    await writeFile(f.exceptionsFile, JSON.stringify({ schemaVersion: 1, exceptions: [{
      id: "historical-inventory", path: "inventory.json", packagePath: "inventory.json",
      selector: { kind: "json-pointer", pointer: "/historical" }, contentSha256: digest(JSON.stringify(historical)), expectedMatches: 1,
      reason: "Immutable pre-refactor inventory field"
    }] }));
    expect((await f.scan()).ok).toBe(true);
    await writeFile(path.join(f.root, "inventory.json"), JSON.stringify({ historical, current: retired }));
    expect((await f.scan()).coverage.unexplainedMatches).toBe(1);
    historical.push({ before: retired, after: "ScienceEvolve" });
    await writeFile(path.join(f.root, "inventory.json"), JSON.stringify({ historical, current: "ScienceEvolve" }));
    const changed = await f.scan();
    expect(changed.ok).toBe(false);
    expect(changed.coverage.unexplainedMatches).toBe(2);
    expect(changed.staleExceptions[0]).toMatchObject({ expectedMatches: 1, actualMatches: 0 });
  });

  it("prints a compact CLI summary by default and exposes full JSON only when requested", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "current.txt"), "ScienceEvolve");
    const args = [gatePath, "--package-root", f.root, "--exceptions", f.exceptionsFile];
    const summary = execFileSync(process.execPath, args, { encoding: "utf8" });
    expect(summary).toMatch(/^Branding verified: 2 files \(2 text, 0 non-text\)/);
    expect(summary).not.toContain('"files":');
    const jsonOutput = execFileSync(process.execPath, [...args, "--json-stdout"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(jsonOutput).coverage.inspectedFiles).toBe(2);
    const outputPath = path.join(f.root, "report.json");
    execFileSync(process.execPath, [...args, "--json", outputPath], { encoding: "utf8" });
    expect(JSON.parse(await readFile(outputPath, "utf8")).ok).toBe(true);
  });

  it("scans a Git-free source archive using repository-relative evidence and checks archive paths", async () => {
    const f = await fixture();
    const evidence = "Original namespace: " + retired;
    await writeFile(path.join(f.root, "history.txt"), evidence);
    await writeFile(f.exceptionsFile, JSON.stringify({ schemaVersion: 1, exceptions: [{
      id: "source-history", path: "history.txt", selector: { kind: "line", sha256: digest(evidence) },
      contentSha256: digest(evidence), expectedMatches: 1, reason: "Source-only pinned historical record"
    }] }));
    const archive = await scanBranding({ sourceRoot: f.root, exceptionsFile: f.exceptionsFile });
    expect(archive.ok).toBe(true);
    expect(archive.mode).toBe("source-archive");
    expect(archive.files.find((file: { path: string }) => file.path === "history.txt").origins).toEqual(["source-archive"]);
    expect((await f.scan()).coverage.unexplainedMatches).toBe(1);
    await writeFile(path.join(f.root, retired + "-legacy.txt"), "ScienceEvolve");
    const changed = await scanBranding({ sourceRoot: f.root, exceptionsFile: f.exceptionsFile });
    expect(changed.ok).toBe(false);
    expect(changed.findings.some((finding: { category: string, status: string }) => finding.category === "path" && finding.status === "unexplained")).toBe(true);
  });

  it("supports source builds without Git metadata, excluding caches while checking generated output", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "source.txt"), "ScienceEvolve");
    await mkdir(path.join(f.root, "node_modules"));
    await writeFile(path.join(f.root, "node_modules", "external.txt"), retired);
    await mkdir(path.join(f.root, "sdk", "dist"), { recursive: true });
    await writeFile(path.join(f.root, "sdk", "dist", "index.js"), retired);
    const report = await scanBranding({ root: f.root, exceptionsFile: f.exceptionsFile });
    expect(report.mode).toBe("source-tree");
    expect(report.coverage.unexplainedMatches).toBe(1);
    expect(report.coverage.generatedFiles).toBe(1);
    expect(report.excludedSourceTreeCaches).toContain("node_modules");
    await writeFile(path.join(f.root, ".git"), "gitdir: missing-metadata");
    await expect(scanBranding({ root: f.root, exceptionsFile: f.exceptionsFile })).rejects.toThrow();
  });

  it("checks an extracted source build without a Git executable and honors explicit broken Git metadata", async () => {
    const f = await fixture();
    const environment = { ...process.env, PATH: "", GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined };
    const args = [gatePath, "--root", f.root, "--exceptions", f.exceptionsFile, "--json-stdout"];
    const output = execFileSync(process.execPath, args, { encoding: "utf8", env: environment, stdio: ["ignore", "pipe", "pipe"] });
    expect(JSON.parse(output)).toMatchObject({ ok: true, mode: "source-tree" });
    expect(() => execFileSync(process.execPath, args, {
      encoding: "utf8", env: { ...environment, GIT_DIR: "missing-metadata" }, stdio: ["ignore", "pipe", "pipe"]
    })).toThrow();
  });

  it("folds literal concatenation without executing code or duplicating an already visible token", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "computed.js"), 'export const name = "sci" + "on" + "-ar";');
    await writeFile(path.join(f.root, "visible.js"), JSON.stringify(retired + "-ar"));
    await writeFile(path.join(f.root, "dynamic.js"), 'const value = unknownFunction() + "-ar";');
    const report = await f.scan();
    const computed = report.findings.filter((finding: { category: string }) => finding.category === "computed-string");
    expect(computed).toHaveLength(1);
    expect(computed[0]).toMatchObject({ path: "computed.js", excerpt: retired + "-ar", status: "unexplained" });
    expect(report.staticStrings).toMatchObject({ status: "executed", eligibleFiles: 3, inspectedFiles: 3 });
  });

  it("folds static templates and reports unavailable parsers explicitly for dependency-free checks", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "computed.ts"), "export const name = `${'sci'}on-ar`;\n");
    const report = await f.scan();
    expect(report.findings.filter((finding: { category: string }) => finding.category === "computed-string")).toHaveLength(1);
    const parserless = path.join(f.root, "parserless.mjs");
    await writeFile(parserless, await readFile(gatePath, "utf8"));
    const delivered = path.join(f.root, "delivery");
    await mkdir(delivered);
    await writeFile(path.join(delivered, "index.js"), 'export const name = "ScienceEvolve";');
    try {
      execFileSync(process.execPath, [parserless, "--package-root", delivered, "--exceptions", f.exceptionsFile, "--json-stdout"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      throw new Error("Dependency-free JS check incorrectly claimed complete folding");
    } catch (error) {
      const result = JSON.parse((error as { stdout: string }).stdout);
      expect(result.staticStrings).toMatchObject({ status: "unavailable", eligibleFiles: 1, inspectedFiles: 0 });
      expect(result.ok).toBe(false);
    }
  });

  it("does not lose retired JSON values overwritten by duplicate keys", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "duplicate.json"), '{"name":"\\u0073' + retired.slice(1) + '","name":"ScienceEvolve"}');
    const report = await f.scan();
    expect(report.ok).toBe(false);
    expect(report.coverage.unexplainedMatches).toBe(1);
    expect(report.findings[0].selector.kind).toBe("json-source-token");
  });
});
