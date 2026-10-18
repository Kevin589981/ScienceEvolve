import { copyFile, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const repository = path.dirname(root);
const sourceRoot = path.join(repository, ".agents", "skills");
const ignoredNames = new Set([
  ".git", ".hg", ".svn", ".DS_Store", ".cache", ".npm-cache",
  "node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "coverage"
]);

// Read builtin resources directly, including in source archives without Git.
// Do not follow symlinks or copy environment files and local caches.
async function listSkillFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name) || entry.name.startsWith(".env") || /\.(?:py[cod]|log)$/i.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSkillFiles(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

const sourceStat = await lstat(sourceRoot).catch((error) => {
  if (error.code === "ENOENT") throw new Error("Build from the source directory: builtin skills are missing", { cause: error });
  throw error;
});
if (!sourceStat.isDirectory()) throw new Error("Builtin skills must be a regular directory");
const files = await listSkillFiles(sourceRoot);
if (!files.length) throw new Error("Build from the source directory: builtin skills are missing");
const outputRoot = path.resolve(root, "assets/skills");
if (!outputRoot.startsWith(root + path.sep)) throw new Error("Invalid generated asset directory");
await rm(outputRoot, { recursive: true, force: true });
for (const file of files) {
  const relative = path.relative(sourceRoot, file);
  const target = path.join(root, "assets/skills", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
}

// Native helpers are not emitted by tsc. Copy only the pinned manifest's
// resources; never sweep an arbitrary working directory into the package.
const manifest = JSON.parse(await readFile(path.join(root, "resources/main-runtime/manifest.json"), "utf8"));
for (const entry of manifest.files) {
  let relative;
  if (entry.target.startsWith("src/core/") && !entry.target.endsWith(".ts")) {
    relative = entry.target.slice("src/".length);
  } else if (entry.target.startsWith("resources/main-runtime/schemas/")) {
    relative = `schemas/${path.basename(entry.target)}`;
  } else continue;
  const source = path.resolve(root, entry.target);
  const destination = path.resolve(root, "dist", relative);
  if (!source.startsWith(root + path.sep) || !destination.startsWith(path.join(root, "dist") + path.sep)) {
    throw new Error("Invalid main-runtime resource path");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  if (relative.startsWith("schemas/")) {
    // main's source-layout fallback is two levels above src/core. Keep this
    // generated copy for source development; dist/schemas is the package copy.
    const developmentDestination = path.resolve(root, relative);
    if (!developmentDestination.startsWith(path.join(root, "schemas") + path.sep)) {
      throw new Error("Invalid development schema path");
    }
    await mkdir(path.dirname(developmentDestination), { recursive: true });
    await copyFile(source, developmentDestination);
  }
}
