import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
};
const root = path.resolve(option("--source-root") ?? fileURLToPath(new URL("../../", import.meta.url)));
const inventoryPath = path.join(root, "docs/renaming/source-delivery-inventory.json");
const git = parameters => execFileSync("git", ["-C", root, ...parameters], { maxBuffer: 32 * 1024 * 1024 });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

if (args.includes("--record")) {
  const naming = JSON.parse(await fs.readFile(path.join(root, "docs/renaming/baseline-inventory.json"), "utf8"));
  const moved = new Map(naming.candidates.map(candidate => [candidate.beforePath, candidate.afterPath]));
  const files = git(["ls-tree", "-r", "-z", naming.baselineCommit]).toString("utf8").split("\0").filter(Boolean).map(entry => {
    const [metadata, originalPath] = entry.split("\t");
    const [mode, type, blob] = metadata.split(" ");
    if (type !== "blob") throw new Error("Baseline contains unsupported non-file entries");
    return { path: moved.get(originalPath) ?? originalPath, sourceMode: mode, sourceBlob: blob };
  });
  if (files.length !== naming.trackedFiles || new Set(files.map(file => file.path)).size !== files.length) throw new Error("Baseline file inventory is incomplete or has path collisions");
  await fs.writeFile(inventoryPath, JSON.stringify({ schemaVersion: 1, baselineCommit: naming.baselineCommit, files }, null, 2) + "\n");
}

const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
const layout = await fs.readFile(path.join(root, "docs/workflows/source-layout-changes.json"), "utf8")
  .then(JSON.parse, error => { if (error.code === "ENOENT") return { schemaVersion: 1, moves: [], removals: [] }; throw error; });
if (layout.schemaVersion !== 1 || !Array.isArray(layout.moves) || !Array.isArray(layout.removals)) throw new Error("Invalid source layout changes");
const movedPaths = new Map(layout.moves.map(entry => [entry.from, entry.to]));
const removedPaths = new Map(layout.removals.map(entry => [entry.path, entry.reason]));
if (movedPaths.size !== layout.moves.length || removedPaths.size !== layout.removals.length ||
    [...movedPaths.keys()].some(file => removedPaths.has(file)) || [...removedPaths.values()].some(reason => !reason?.trim())) {
  throw new Error("Source layout changes must have unique, non-overlapping paths and explicit removal reasons");
}
const hasGitMetadata = await fs.lstat(path.join(root, ".git")).then(() => true, error => {
  if (error.code === "ENOENT") return false;
  throw error;
});
const sourceArchive = args.includes("--source-root") || !hasGitMetadata;
if (sourceArchive && option("--git-revision")) throw new Error("A Git revision check requires repository metadata");
let tracked;
if (!sourceArchive) {
  const revision = option("--git-revision");
  const entries = git(revision ? ["ls-tree", "-r", "-z", revision] : ["ls-files", "--stage", "-z"]).toString("utf8").split("\0").filter(Boolean);
  tracked = new Map(entries.map(entry => {
    const [metadata, file] = entry.split("\t");
    return [file, metadata.split(" ")[0]];
  }));
}
const missingFiles = [], untrackedFiles = [], modeMismatches = [], invalidPaths = [];
const resolved = relative => {
  const absolute = path.resolve(root, relative);
  if (relative.includes("\\") || path.relative(root, absolute).startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe delivery inventory path: ${relative}`);
  return absolute;
};
for (const [from, to] of movedPaths) { resolved(from); resolved(to); }
for (const file of removedPaths.keys()) {
  const exists = await fs.lstat(resolved(file)).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  if (exists) throw new Error(`Declared obsolete source still exists: ${file}`);
}
const deliveryFiles = inventory.files.filter(entry => !removedPaths.has(entry.path))
  .map(entry => ({ ...entry, originalPath: entry.path, path: movedPaths.get(entry.path) ?? entry.path }));
for (const entry of deliveryFiles) {
  const filename = resolved(entry.path);
  try { if (!(await fs.lstat(filename)).isFile()) invalidPaths.push(entry.path); }
  catch (error) { if (error.code === "ENOENT") missingFiles.push(entry.path); else throw error; }
  if (tracked && !tracked.has(entry.path)) untrackedFiles.push(entry.path);
  else if (tracked && tracked.get(entry.path) !== entry.sourceMode) modeMismatches.push({ path: entry.path, expected: entry.sourceMode, actual: tracked.get(entry.path) });
}
const vendorIssues = [];
let manifests = 0, vendorFiles = 0;
for (const entry of deliveryFiles.filter(file => /\/(?:UPSTREAM|INTEGRITY_UPSTREAM)\.json$/.test(file.path))) {
  const manifest = JSON.parse(await fs.readFile(resolved(entry.path), "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error(`Invalid source manifest: ${entry.path}`);
  manifests++;
  for (const pinned of manifest.files) {
    vendorFiles++;
    const target = path.posix.join(path.posix.dirname(entry.path), pinned.path);
    try {
      const actual = hash(await fs.readFile(resolved(target)));
      if (actual !== pinned.sha256) vendorIssues.push({ path: target, reason: "pinned-byte-mismatch", expected: pinned.sha256, actual });
      if (tracked && !tracked.has(target)) vendorIssues.push({ path: target, reason: "not-tracked-for-delivery" });
    } catch (error) { if (error.code === "ENOENT") vendorIssues.push({ path: target, reason: "missing-file" }); else throw error; }
  }
}
const report = {
  schemaVersion: 1, baselineCommit: inventory.baselineCommit,
  mode: sourceArchive ? "source-archive-files" : "git-delivery",
  gitRevision: sourceArchive ? null : option("--git-revision") ?? "index",
  expectedSourceFiles: inventory.files.length, executableFiles: inventory.files.filter(file => file.sourceMode === "100755").length,
  declaredMoves: inventory.files.filter(file => movedPaths.has(file.path)).length,
  declaredRemovals: inventory.files.filter(file => removedPaths.has(file.path)).map(file => ({ path: file.path, reason: removedPaths.get(file.path) })),
  deliveredOriginalEntries: deliveryFiles.length, uniqueDeliveryPaths: new Set(deliveryFiles.map(file => file.path)).size,
  manifests, vendorFiles, missingFiles, untrackedFiles, modeMismatches, invalidPaths, vendorIssues,
  executableModesChecked: !sourceArchive,
  passed: ![missingFiles, untrackedFiles, modeMismatches, invalidPaths, vendorIssues].some(list => list.length)
};
if (option("--json")) await fs.writeFile(path.resolve(option("--json")), JSON.stringify(report, null, 2) + "\n");
console.log(`Source delivery ${report.passed ? "verified" : "failed"}: ${report.expectedSourceFiles} baseline entries, ${report.declaredMoves} declared moves, ${report.declaredRemovals.length} declared removals, ${report.uniqueDeliveryPaths} delivery paths; ${manifests} vendor manifests/${vendorFiles} pins; ${missingFiles.length} missing, ${untrackedFiles.length} untracked, ${modeMismatches.length} mode mismatches, ${vendorIssues.length} vendor issues.`);
if (!report.passed) process.exitCode = 1;
