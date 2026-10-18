import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// This explicit historical token has one reviewed, exact rule-line exception.
const retiredToken = "scion";
const patternSource = [...retiredToken].join("[\\s_.\\-]*") + "(?:[\\s_.\\-]*a[\\s_.\\-]*r)?";
const generatedDirectories = ["sdk/dist", "sdk/assets", "sdk/schemas"];
// A local Git exclude can hide even first-party SDK additions. Enumerate these
// delivery roots independently; dependency caches remain outside these roots.
const ownedDirectories = ["sdk/cli", "sdk/docs", "sdk/examples", "sdk/resources", "sdk/scripts", "sdk/skills", "sdk/src", "sdk/tests"];
const textExtensions = new Set([".md", ".mdx", ".txt", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".svg", ".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".ps1", ".cmd", ".bat", ".cs", ".c", ".h", ".cpp", ".sql", ".patch", ".diff"]);
const ownRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultExceptions = path.join(ownRoot, "sdk/resources/branding/exceptions.json");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const portable = (value) => value.split(path.sep).join("/");
const matches = (value) => [...value.matchAll(new RegExp(patternSource, "giu"))]
  .map((match) => ({ value: match[0], offset: match.index }));
const escapePointer = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
const sourceTreeCaches = new Set(["node_modules", "__pycache__", ".git", ".cache", ".npm-cache", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".vite", ".venv"]);
const sourceTreeRootCaches = new Set(["coverage", "temp", "data"]);
const scriptExtensions = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"]);
let staticParser;

async function loadStaticParser() {
  staticParser ??= (async () => {
    try {
      const imported = await import("typescript");
      const parser = imported.default ?? imported;
      const lockPath = path.join(ownRoot, "package-lock.json");
      let pinnedVersion;
      if (await exists(lockPath)) {
        const lock = JSON.parse(await readFile(lockPath, "utf8"));
        pinnedVersion = lock.packages?.["node_modules/typescript"]?.version;
        if (pinnedVersion && parser.version !== pinnedVersion) {
          throw new Error(`Static parser version drift: lock pins ${pinnedVersion}, installed ${parser.version}`);
        }
      }
      if (!pinnedVersion) throw new Error("Static string folding requires the source workspace lockfile's exact TypeScript version");
      return { parser, version: parser.version, pinnedVersion: pinnedVersion ?? null };
    } catch (error) { return { parser: null, version: null, reason: error.message }; }
  })();
  return staticParser;
}

function foldedStrings(parser, value, relative) {
  const source = parser.createSourceFile(relative, value, parser.ScriptTarget.Latest, true);
  const units = [];
  let evaluatedExpressions = 0;
  function fold(node, depth = 0) {
    if (depth > 100) return undefined;
    if (parser.isParenthesizedExpression(node)) return fold(node.expression, depth + 1);
    if (parser.isStringLiteral(node) || parser.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (parser.isBinaryExpression(node) && node.operatorToken.kind === parser.SyntaxKind.PlusToken) {
      const left = fold(node.left, depth + 1), right = fold(node.right, depth + 1);
      return left !== undefined && right !== undefined && left.length + right.length <= 4 * 1024 * 1024 ? left + right : undefined;
    }
    if (parser.isTemplateExpression(node)) {
      let output = node.head.text;
      for (const span of node.templateSpans) {
        const expression = fold(span.expression, depth + 1);
        if (expression === undefined || output.length + expression.length + span.literal.text.length > 4 * 1024 * 1024) return undefined;
        output += expression + span.literal.text;
      }
      return output;
    }
    return undefined;
  }
  function visit(node) {
    const composite = parser.isTemplateExpression(node) || parser.isNoSubstitutionTemplateLiteral(node) ||
      (parser.isBinaryExpression(node) && node.operatorToken.kind === parser.SyntaxKind.PlusToken);
    if (composite) {
      const folded = fold(node);
      if (folded !== undefined) {
        evaluatedExpressions++;
        const start = node.getStart(source), original = value.slice(start, node.end);
        if (matches(original).length === 0 && matches(folded).length > 0) {
          units.push({ selector: { kind: "computed-string", expressionSha256: digest(original) }, value: folded,
            line: source.getLineAndCharacterOfPosition(start).line + 1,
            expression: original.length > 500 ? original.slice(0, 500) + "…" : original });
          return; // One outer static value already accounts for all of its nested literals.
        }
      }
    }
    parser.forEachChild(node, visit);
  }
  visit(source);
  return { units, evaluatedExpressions };
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function walk(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = portable(path.join(relative, entry.name));
    // Package scans include every delivered file. Never follow a directory symlink.
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else files.push(child);
  }
  return files;
}

async function walkSourceTree(root, relative = "", excluded = []) {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = portable(path.join(relative, entry.name));
    if ((entry.isDirectory() || entry.isSymbolicLink()) &&
        (sourceTreeCaches.has(entry.name) || (!relative && sourceTreeRootCaches.has(entry.name)))) {
      excluded.push(child);
      continue;
    }
    if (entry.isDirectory()) files.push(...await walkSourceTree(root, child, excluded));
    else files.push(child);
  }
  return files;
}

function gitRoot(root) {
  return execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function isRepositoryRoot(root) {
  // Existing but corrupt metadata must fail through Git, never become an archive.
  if (await exists(path.join(root, ".git"))) return true;
  // A normal checkout/worktree root has a .git directory/file. An extracted
  // source tree has neither and must build even when Git itself is unavailable.
  // Honor explicitly configured metadata instead of hiding genuine Git failures.
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE || process.env.GIT_COMMON_DIR) {
    return path.resolve(gitRoot(root)) === root;
  }
  return false;
}

function decode(bytes, relative) {
  let encoding = "utf-8";
  let input = bytes;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    input = bytes.subarray(2);
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    input = bytes.subarray(2);
  } else if (bytes.length >= 4 && bytes.length % 2 === 0) {
    // Also recognize BOM-less ASCII-heavy UTF-16 without treating binary data as text.
    let evenNulls = 0;
    let oddNulls = 0;
    const size = Math.min(bytes.length, 8192);
    for (let index = 0; index < size; index += 2) {
      if (bytes[index] === 0) evenNulls++;
      if (bytes[index + 1] === 0) oddNulls++;
    }
    if (oddNulls > size / 8 && evenNulls < size / 32) encoding = "utf-16le";
    else if (evenNulls > size / 8 && oddNulls < size / 32) encoding = "utf-16be";
  }
  try {
    const value = new TextDecoder(encoding, { fatal: true }).decode(input);
    // PDF-extracted Markdown can contain form feeds or other control marks.
    // A valid decoding remains searchable text unless it contains binary NULs.
    if (value.includes("\u0000") && !textExtensions.has(path.posix.extname(relative).toLowerCase())) return null;
    return { encoding, value };
  } catch { return null; }
}

function jsonUnits(value, pointer = "", fieldDigests = new Map()) {
  fieldDigests.set(pointer, digest(typeof value === "string" ? value : JSON.stringify(value)));
  if (typeof value === "string") return [{ selector: { kind: "json-pointer", pointer }, value }];
  if (!value || typeof value !== "object") return [];
  const units = [];
  for (const [key, child] of Object.entries(value)) {
    const childPointer = pointer + "/" + escapePointer(key);
    if (!Array.isArray(value)) units.push({ selector: { kind: "json-key", pointer: childPointer }, value: key });
    units.push(...jsonUnits(child, childPointer, fieldDigests));
  }
  return units;
}

function textUnits(value, relative, fieldDigests) {
  if (path.posix.extname(relative).toLowerCase() === ".json") {
    try {
      const units = jsonUnits(JSON.parse(value), "", fieldDigests);
      // JSON.parse keeps only the last duplicate key. Check every original string
      // token too, so an overwritten or escaped retired value cannot disappear.
      const available = new Map();
      for (const unit of units) available.set(unit.value, (available.get(unit.value) ?? 0) + 1);
      for (const token of value.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
        const decoded = JSON.parse(token[0]);
        const count = available.get(decoded) ?? 0;
        if (count > 0) available.set(decoded, count - 1);
        else if (matches(decoded).length) units.push({ selector: { kind: "json-source-token", offset: token.index },
          value: decoded, line: value.slice(0, token.index).split("\n").length });
      }
      return units;
    }
    catch { /* Malformed JSON is still scanned as plain text, rather than omitted. */ }
  }
  return value.split(/\r?\n/u).map((line, index) => ({
    selector: { kind: "line", sha256: digest(line) }, value: line, line: index + 1
  }));
}

function validateExceptions(document) {
  if (document.schemaVersion !== 1 || !Array.isArray(document.exceptions)) {
    throw new Error("Invalid branding exceptions schema");
  }
  const ids = new Set();
  for (const entry of document.exceptions) {
    if (!entry.id || ids.has(entry.id)) throw new Error("Missing or duplicate exception id");
    ids.add(entry.id);
    for (const relative of [entry.path, entry.packagePath].filter((item) => item !== undefined)) {
      if (typeof relative !== "string" || !relative || relative.includes("\\") ||
          relative.startsWith("/") || relative.split("/").some((part) => part === "..") ||
          /[*?\[\]]/u.test(relative)) throw new Error(`Exception ${entry.id} needs an exact relative path`);
    }
    if (typeof entry.path !== "string" || typeof entry.reason !== "string" || !entry.reason.trim() ||
        !Number.isSafeInteger(entry.expectedMatches) || entry.expectedMatches < 1 ||
        !/^[a-f0-9]{64}$/u.test(entry.contentSha256 ?? "") ||
        !["line", "json-pointer", "json-key", "path", "binary-string", "computed-string"].includes(entry.selector?.kind)) {
      throw new Error(`Invalid precise exception ${entry.id}`);
    }
    if (["json-pointer", "json-key"].includes(entry.selector.kind) &&
        typeof entry.selector.pointer !== "string") throw new Error(`Missing JSON pointer in ${entry.id}`);
    if (entry.selector.kind === "line" && entry.selector.sha256 !== entry.contentSha256) {
      throw new Error(`Line selector and content digest differ in ${entry.id}`);
    }
    if (entry.selector.kind === "binary-string" && !["latin1", "utf-16le", "utf-16be"].includes(entry.selector.encoding)) {
      throw new Error(`Missing binary encoding in ${entry.id}`);
    }
  }
  return document.exceptions;
}

function sameSelector(left, right) {
  return left.kind === right.kind && left.pointer === right.pointer &&
    left.sha256 === right.sha256 && left.encoding === right.encoding &&
    left.expressionSha256 === right.expressionSha256;
}

/** Inspect the actual checkout or unpacked delivery, with exact, stale-sensitive exceptions. */
export async function scanBranding(options = {}) {
  let mode = options.packageRoot ? "package" : options.sourceRoot ? "source-archive" : "repository";
  const root = path.resolve(options.packageRoot ?? options.sourceRoot ?? options.root ?? ownRoot);
  if (mode === "repository" && !await isRepositoryRoot(root)) mode = "source-tree";
  const exceptionFile = path.resolve(options.exceptionsFile ?? defaultExceptions);
  const exceptionDocument = JSON.parse(await readFile(exceptionFile, "utf8"));
  const allExceptions = validateExceptions(exceptionDocument);
  const exceptions = allExceptions.filter((entry) => mode !== "package" || entry.packagePath !== undefined);
  const exceptionPaths = new Map();
  for (const entry of exceptions) {
    const relative = mode === "package" ? entry.packagePath : entry.path;
    const list = exceptionPaths.get(relative) ?? [];
    list.push(entry);
    exceptionPaths.set(relative, list);
  }
  const exceptionCounts = new Map(exceptions.map((entry) => [entry.id, 0]));
  const candidates = new Map();
  const missingTrackedFiles = [];
  const excludedSourceTreeCaches = [];
  if (mode === "repository") {
    const gitFiles = (args) => execFileSync("git", ["-C", root, "ls-files", "-z", ...args],
      { maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").split("\0").filter(Boolean);
    for (const relative of gitFiles(["--cached"])) candidates.set(relative, new Set(["tracked"]));
    for (const relative of gitFiles(["--others", "--exclude-standard"])) {
      const sources = candidates.get(relative) ?? new Set(); sources.add("untracked-delivery"); candidates.set(relative, sources);
    }
    for (const directory of ownedDirectories) {
      if (!await exists(path.join(root, directory))) continue;
      for (const child of await walk(path.join(root, directory))) {
        const relative = directory + "/" + child;
        const sources = candidates.get(relative) ?? new Set(); sources.add("owned-source"); candidates.set(relative, sources);
      }
    }
    if (await exists(path.join(root, "sdk"))) {
      for (const entry of await readdir(path.join(root, "sdk"), { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        const relative = "sdk/" + entry.name;
        const sources = candidates.get(relative) ?? new Set(); sources.add("owned-source"); candidates.set(relative, sources);
      }
    }
    for (const directory of generatedDirectories) {
      if (!await exists(path.join(root, directory))) continue;
      for (const child of await walk(path.join(root, directory))) {
        const relative = directory + "/" + child;
        const sources = candidates.get(relative) ?? new Set(); sources.add("generated"); candidates.set(relative, sources);
      }
    }
  } else if (mode === "source-tree") {
    for (const relative of await walkSourceTree(root, "", excludedSourceTreeCaches)) {
      const origins = new Set([mode]);
      if (generatedDirectories.some((directory) => relative.startsWith(directory + "/"))) origins.add("generated");
      candidates.set(relative, origins);
    }
  } else {
    for (const relative of await walk(root)) candidates.set(relative, new Set([mode]));
  }
  const findings = [];
  const files = [];
  const binaryFiles = [];
  const errors = [];
  const staticStrings = { status: "not-applicable", parser: "typescript", parserVersion: null,
    pinnedVersion: null, eligibleFiles: 0, inspectedFiles: 0, evaluatedExpressions: 0, computedHitUnits: 0, skippedFiles: [] };
  function inspect(relative, unit, category, fieldDigests = new Map()) {
    const found = matches(unit.value);
    if (found.length === 0) return;
    const contentSha256 = digest(unit.value);
    const allowed = (exceptionPaths.get(relative) ?? []).filter((entry) => {
      if (sameSelector(entry.selector, unit.selector) && entry.contentSha256 === contentSha256) return true;
      // An immutable historical inventory can be pinned to one exact object or
      // array field. Its digest covers every child and its count must still agree.
      return entry.selector.kind === "json-pointer" &&
        ["json-pointer", "json-key"].includes(unit.selector.kind) &&
        unit.selector.pointer.startsWith(entry.selector.pointer + "/") &&
        entry.contentSha256 === fieldDigests.get(entry.selector.pointer);
    });
    if (allowed.length > 1) errors.push(`Ambiguous exceptions for ${relative}: ${allowed.map((entry) => entry.id).join(", ")}`);
    const exception = allowed.length === 1 ? allowed[0] : undefined;
    if (exception) exceptionCounts.set(exception.id, exceptionCounts.get(exception.id) + found.length);
    findings.push({ path: relative, category, selector: unit.selector,
      ...(unit.line === undefined ? {} : { line: unit.line }), contentSha256,
      ...(unit.expression === undefined ? {} : { expression: unit.expression }),
      excerpt: unit.value.length > 500 ? unit.value.slice(0, 500) + "…" : unit.value,
      matches: found, status: exception ? "retained" : "unexplained",
      ...(exception ? { exceptionId: exception.id, reason: exception.reason } : {}) });
  }
  for (const [relative, origins] of [...candidates].sort(([left], [right]) => left.localeCompare(right))) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(root + path.sep)) { errors.push(`Path escaped scan root: ${relative}`); continue; }
    let info;
    try { info = await lstat(absolute); }
    catch (error) {
      if (error.code === "ENOENT" && origins.has("tracked")) { missingTrackedFiles.push(relative); continue; }
      errors.push(`Cannot inspect ${relative}: ${error.message}`); continue;
    }
    inspect(relative, { selector: { kind: "path" }, value: relative }, "path");
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      files.push({ path: relative, origins: [...origins], kind: "symlink", bytes: info.size, sha256: digest(target) });
      inspect(relative, { selector: { kind: "line", sha256: digest(target) }, value: target, line: 1 }, "symlink-target");
      continue;
    }
    if (!info.isFile()) { errors.push(`Unsupported delivery entry: ${relative}`); continue; }
    let bytes;
    try { bytes = await readFile(absolute); }
    catch (error) { errors.push(`Cannot read ${relative}: ${error.message}`); continue; }
    const decoded = decode(bytes, relative);
    files.push({ path: relative, origins: [...origins], kind: decoded ? "text" : "non-text",
      bytes: bytes.length, sha256: digest(bytes), ...(decoded ? { encoding: decoded.encoding } : {}) });
    if (decoded) {
      const fieldDigests = new Map();
      for (const unit of textUnits(decoded.value, relative, fieldDigests)) inspect(relative, unit, "content", fieldDigests);
      if (scriptExtensions.has(path.posix.extname(relative).toLowerCase())) {
        staticStrings.eligibleFiles++;
        const loaded = await loadStaticParser();
        if (loaded.parser) {
          staticStrings.status = "executed";
          staticStrings.parserVersion = loaded.version;
          staticStrings.pinnedVersion = loaded.pinnedVersion;
          const folded = foldedStrings(loaded.parser, decoded.value, relative);
          staticStrings.inspectedFiles++;
          staticStrings.evaluatedExpressions += folded.evaluatedExpressions;
          staticStrings.computedHitUnits += folded.units.length;
          for (const unit of folded.units) inspect(relative, unit, "computed-string");
        } else {
          staticStrings.status = "unavailable";
          staticStrings.skippedFiles.push({ path: relative, reason: loaded.reason });
        }
      }
    } else {
      const binary = { path: relative, bytes: bytes.length, sha256: digest(bytes),
        extension: path.posix.extname(relative).toLowerCase(), review: "Needs source attribution or visual/format-specific review" };
      binaryFiles.push(binary);
      // Raw ASCII and UTF-16 strings supplement (but never claim to replace) visual/PDF review.
      for (const encoding of ["latin1", "utf-16le", "utf-16be"]) {
        const value = encoding === "latin1" ? bytes.toString("latin1") : new TextDecoder(encoding).decode(bytes);
        for (const match of matches(value)) {
          inspect(relative, { selector: { kind: "binary-string", encoding }, value: match.value }, "binary-string");
        }
      }
    }
  }
  const staleExceptions = exceptions.map((entry) => ({ id: entry.id,
    path: mode === "package" ? entry.packagePath : entry.path,
    expectedMatches: entry.expectedMatches, actualMatches: exceptionCounts.get(entry.id) }))
    .filter((entry) => entry.expectedMatches !== entry.actualMatches);
  const unexplained = findings.filter((finding) => finding.status === "unexplained");
  if (staticStrings.status === "unavailable") errors.push("Static string folding unavailable; install the locked source development dependencies before claiming complete JS/TS coverage");
  const countMatches = (items) => items.reduce((total, item) => total + item.matches.length, 0);
  return {
    schemaVersion: 1, mode, root, exceptionFile,
    ok: unexplained.length === 0 && staleExceptions.length === 0 && errors.length === 0,
    coverage: {
      discoveredFiles: candidates.size, inspectedFiles: files.length,
      textFiles: files.filter((file) => file.kind === "text").length,
      nonTextFiles: binaryFiles.length, symlinks: files.filter((file) => file.kind === "symlink").length,
      missingTrackedFiles: missingTrackedFiles.length,
      generatedFiles: files.filter((file) => file.origins.includes("generated")).length,
      pathHitUnits: findings.filter((finding) => finding.category === "path").length,
      contentHitUnits: findings.filter((finding) => finding.category !== "path").length,
      totalMatches: countMatches(findings), retainedMatches: countMatches(findings.filter((finding) => finding.status === "retained")),
      unexplainedMatches: countMatches(unexplained), staleExceptions: staleExceptions.length,
      inspectedBytes: files.reduce((total, file) => total + file.bytes, 0)
    },
    files, findings, binaryFiles, staleExceptions, missingTrackedFiles, excludedSourceTreeCaches, staticStrings, errors
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  let jsonFile;
  let jsonStdout = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help") {
      process.stdout.write("Usage: node scripts/check-branding.mjs [--root REPOSITORY | --package-root UNPACKED_PACKAGE | --source-root SOURCE_ARCHIVE] [--exceptions FILE] [--json OUTPUT] [--json-stdout]\n");
      return;
    }
    if (flag === "--json-stdout") { jsonStdout = true; continue; }
    if (!["--root", "--package-root", "--source-root", "--exceptions", "--json"].includes(flag) || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${flag}`);
    }
    const value = args[++index];
    if (flag === "--json") jsonFile = path.resolve(value);
    else options[{ "--root": "root", "--package-root": "packageRoot", "--source-root": "sourceRoot", "--exceptions": "exceptionsFile" }[flag]] = value;
  }
  if ([options.root, options.packageRoot, options.sourceRoot].filter(Boolean).length > 1) throw new Error("Choose exactly one repository, package or source archive scan mode");
  const report = await scanBranding(options);
  const serialized = JSON.stringify(report, null, 2) + "\n";
  if (jsonFile) {
    await mkdir(path.dirname(jsonFile), { recursive: true });
    await writeFile(jsonFile, serialized);
  }
  const summary = `Branding ${report.ok ? "verified" : "FAILED"}: ${report.coverage.inspectedFiles} files ` +
    `(${report.coverage.textFiles} text, ${report.binaryFiles.length} non-text), ` +
    `${report.coverage.totalMatches} matches (${report.coverage.retainedMatches} retained, ` +
    `${report.coverage.unexplainedMatches} unexplained), ${report.staleExceptions.length} stale exceptions, ` +
    `${report.errors.length} errors; static strings ${report.staticStrings.inspectedFiles}/${report.staticStrings.eligibleFiles} JS/TS files ` +
    `(${report.staticStrings.status})${jsonFile ? `; report: ${jsonFile}` : ""}\n`;
  if (jsonStdout) { process.stdout.write(serialized); process.stderr.write(summary); }
  else process.stdout.write(summary);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
}
