import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareMainProjectInputs, type MainProjectInput } from "../src/main-project-inputs.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scienceevolve-main-inputs-"));
  roots.push(root);
  const destination = path.join(root, "user_inputs");
  await fs.mkdir(destination);
  return { root, destination };
}
async function file(root: string, name = "source.txt", data: string | Buffer = "original") {
  const location = path.join(root, name);
  await fs.writeFile(location, data);
  return location;
}

describe("main project input originals", () => {
  it("maps files and nested directories and preserves exact image bytes without exposing source paths", async () => {
    const { root, destination } = await fixture();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 42]);
    const image = await file(root, "photo.png", png);
    const directory = path.join(root, "assets");
    await fs.mkdir(path.join(directory, "nested"), { recursive: true });
    await file(path.join(directory, "nested"), "note.txt", "nested text");
    const prepared = await prepareMainProjectInputs([image, { path: directory, name: "references" }]);
    expect(prepared!.files).toEqual(["photo.png", "references/nested/note.txt"]);
    expect(Object.isFrozen(prepared!.files)).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain(root);
    await prepared!.install(destination);
    expect(await fs.readFile(path.join(destination, "photo.png"))).toEqual(png);
    expect(await fs.readFile(path.join(destination, "references/nested/note.txt"), "utf8")).toBe("nested text");
    expect(await fs.readFile(image)).toEqual(png);
    const other = path.join(root, "other");
    await fs.mkdir(other);
    await (await prepareMainProjectInputs([{ path: image, name: "pictures/renamed.png" }, directory]))!.install(other);
    expect(await fs.readFile(path.join(other, "pictures/renamed.png"))).toEqual(png);
    expect(await fs.readFile(path.join(other, "assets/nested/note.txt"), "utf8")).toBe("nested text");
  });

  it("accepts no inputs and rejects malformed descriptors and relative sources", async () => {
    expect(await prepareMainProjectInputs(undefined)).toBeUndefined();
    expect(await prepareMainProjectInputs([])).toBeUndefined();
    for (const value of [null, {}, "file", [null], [12], ["relative.txt"], [{ path: "relative" }], [{ path: "/tmp/a", extra: true }]]) {
      await expect(prepareMainProjectInputs(value as MainProjectInput[])).rejects.toThrow();
    }
  });

  it("rejects nonportable target names before installing", async () => {
    const { root } = await fixture();
    const source = await file(root);
    for (const name of ["", "/absolute", "../escape", "a/../b", "./a", "a//b", "a\\b", "C:/a", "con.txt", "LPT9", "a.", "a ", "a\0b", "a\nb", "a?", "x".repeat(256), Array(10).fill("x".repeat(120)).join("/")]) {
      await expect(prepareMainProjectInputs([{ path: source, name }])).rejects.toThrow(/relative path/);
    }
  });

  it("rejects duplicate source identities, duplicate paths, case conflicts, and file-directory conflicts", async () => {
    const { root } = await fixture();
    const a = await file(root, "a.txt");
    const b = await file(root, "b.txt");
    for (const inputs of [
      [a, { path: a, name: "other.txt" }],
      [{ path: a, name: "same" }, { path: b, name: "same" }],
      [{ path: a, name: "A/x" }, { path: b, name: "a/y" }],
      [{ path: a, name: "same" }, { path: b, name: "same/child" }],
    ]) await expect(prepareMainProjectInputs(inputs)).rejects.toThrow(/Duplicate|conflicting/);
  });

  it("rejects hard links", async () => {
    const { root } = await fixture();
    const source = await file(root);
    const link = path.join(root, "hard.txt");
    await fs.link(source, link);
    await expect(prepareMainProjectInputs([link])).rejects.toThrow(/Hard linked/);
    expect(await fs.readFile(source, "utf8")).toBe("original");
  });

  it("rejects file symlinks when the host permits creating them", async (context) => {
    const { root } = await fixture();
    const source = await file(root);
    const link = path.join(root, "link.txt");
    try { await fs.symlink(source, link, "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        context.skip(`File symlinks unavailable on this host: ${(error as NodeJS.ErrnoException).code}`);
        return;
      }
      throw error;
    }
    await expect(prepareMainProjectInputs([link])).rejects.toThrow(/Unsupported/);
  });

  it("rejects directory junctions as roots, nested entries, source ancestors, and destination parents", async () => {
    const { root, destination } = await fixture();
    const external = path.join(root, "external");
    await fs.mkdir(external);
    await file(external);
    const directory = path.join(root, "folder");
    await fs.mkdir(directory);
    const link = path.join(directory, "escape");
    await fs.symlink(external, link, process.platform === "win32" ? "junction" : "dir");
    await expect(prepareMainProjectInputs([link])).rejects.toThrow(/Unsupported/);
    await expect(prepareMainProjectInputs([directory])).rejects.toThrow(/Unsupported/);
    await expect(prepareMainProjectInputs([path.join(link, "source.txt")])).rejects.toThrow(/ordinary directories/);
    const source = await file(root);
    const prepared = await prepareMainProjectInputs([{ path: source, name: "escape/new.txt" }]);
    await fs.symlink(external, path.join(destination, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepared!.install(destination)).rejects.toThrow(/ordinary directories/);
    expect(await fs.readdir(external)).toEqual(["source.txt"]);
  });

  it("revalidates source changes and source parent replacement before creating files", async () => {
    const { root, destination } = await fixture();
    const source = await file(root);
    const prepared = await prepareMainProjectInputs([source]);
    await fs.writeFile(source, "changed content");
    await expect(prepared!.install(destination)).rejects.toThrow(/changed/);
    expect(await fs.readdir(destination)).toEqual([]);
    const directory = path.join(root, "source-folder");
    await fs.mkdir(directory);
    await file(directory);
    const folder = await prepareMainProjectInputs([directory]);
    await fs.rename(directory, `${directory}-old`);
    await fs.mkdir(directory);
    await file(directory);
    await expect(folder!.install(destination)).rejects.toThrow(/changed/);
  });

  it("preflights all targets without overwriting files or accepting case conflicts", async () => {
    const { root, destination } = await fixture();
    const a = await file(root, "a.txt");
    const b = await file(root, "b.txt");
    await file(destination, "b.txt", "existing");
    await expect((await prepareMainProjectInputs([a, b]))!.install(destination)).rejects.toThrow(/already exists/);
    expect(await fs.readdir(destination)).toEqual(["b.txt"]);
    expect(await fs.readFile(path.join(destination, "b.txt"), "utf8")).toBe("existing");
    await expect((await prepareMainProjectInputs([{ path: a, name: "B.TXT" }]))!.install(destination)).rejects.toThrow(/case conflict/);
  });

  it("rolls back only newly installed files after a partial failure and leaves source permissions intact", async () => {
    const { root, destination } = await fixture();
    const a = await file(root, "a.txt");
    const b = await file(root, "b.txt");
    const before = await fs.stat(a);
    await file(destination, "keep.txt", "keep");
    const prepared = await prepareMainProjectInputs([a, b]);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (args[0] === path.join(destination, "b.txt")) throw new Error("injected copy failure");
      return open(...args);
    });
    await expect(prepared!.install(destination)).rejects.toThrow(/injected copy failure/);
    expect(await fs.readdir(destination)).toEqual(["keep.txt"]);
    expect(await fs.readFile(a, "utf8")).toBe("original");
    expect((await fs.stat(a)).mode).toBe(before.mode);
    vi.restoreAllMocks();
    await prepared!.rollback();
    await prepared!.install(destination);
    expect(await fs.readFile(path.join(destination, "a.txt"), "utf8")).toBe("original");
    await prepared!.rollback();
    expect(await fs.readdir(destination)).toEqual(["keep.txt"]);
  });

  it("rolls back a completed installation idempotently while preserving preexisting files and directories", async () => {
    const { root, destination } = await fixture();
    const source = await file(root);
    await fs.mkdir(path.join(destination, "nested"));
    await file(destination, "keep.txt", "existing");
    const prepared = (await prepareMainProjectInputs([{ path: source, name: "nested/copied.txt" }]))!;
    await prepared.rollback();
    await prepared.install(destination);
    await prepared.rollback();
    await prepared.rollback();
    expect(await fs.readdir(destination)).toEqual(["keep.txt", "nested"]);
    expect(await fs.readdir(path.join(destination, "nested"))).toEqual([]);
    expect(await fs.readFile(path.join(destination, "keep.txt"), "utf8")).toBe("existing");
    expect(await fs.readFile(source, "utf8")).toBe("original");
    await prepared.install(destination);
    expect(await fs.readFile(path.join(destination, "nested/copied.txt"), "utf8")).toBe("original");
  });

  it("preserves subsequently edited and replaced files during completed rollback", async () => {
    const { root, destination } = await fixture();
    const sources = await Promise.all(["a.txt", "b.txt", "c.txt"].map((name) => file(root, name)));
    const prepared = (await prepareMainProjectInputs(sources))!;
    await prepared.install(destination);
    const a = path.join(destination, "a.txt");
    const b = path.join(destination, "b.txt");
    await fs.writeFile(a, "modified"); // Same byte length as the original, so timestamps matter.
    await fs.utimes(a, new Date(0), new Date(0));
    await fs.rename(b, path.join(root, "moved-copy.txt"));
    await fs.writeFile(b, "replacement");
    await prepared.rollback();
    await prepared.rollback();
    expect(await fs.readdir(destination)).toEqual(["a.txt", "b.txt"]);
    expect(await fs.readFile(a, "utf8")).toBe("modified");
    expect(await fs.readFile(b, "utf8")).toBe("replacement");
  });

  it("excludes concurrent installation and rollback and preserves replaced parents", async () => {
    const { root, destination } = await fixture();
    const source = await file(root);
    const prepared = (await prepareMainProjectInputs([{ path: source, name: "nested/copy.txt" }]))!;
    const installing = prepared.install(destination);
    await expect(prepared.rollback()).rejects.toThrow(/in progress/);
    await expect(prepared.install(destination)).rejects.toThrow(/in progress/);
    await installing;
    await fs.rename(path.join(destination, "nested"), path.join(destination, "moved"));
    await fs.mkdir(path.join(destination, "nested"));
    await file(path.join(destination, "nested"), "copy.txt", "replacement");
    const rollingBack = prepared.rollback();
    await expect(prepared.install(destination)).rejects.toThrow(/in progress/);
    await rollingBack;
    expect(await fs.readFile(path.join(destination, "nested/copy.txt"), "utf8")).toBe("replacement");
    expect(await fs.readFile(path.join(destination, "moved/copy.txt"), "utf8")).toBe("original");
  });

  it("bounds input count and sparse file sizes without reading their contents", async () => {
    const { root } = await fixture();
    const source = await file(root);
    await expect(prepareMainProjectInputs(Array(1001).fill(source))).rejects.toThrow(/1000/);
    await fs.truncate(source, 50 * 1024 * 1024 + 1);
    await expect(prepareMainProjectInputs([source])).rejects.toThrow(/50 MiB/);
    const sources: string[] = [];
    for (let i = 0; i < 5; i++) {
      const location = await file(root, `${i}.bin`, "");
      await fs.truncate(location, 41 * 1024 * 1024);
      sources.push(location);
    }
    await expect(prepareMainProjectInputs(sources)).rejects.toThrow(/200 MiB/);
  });

  it("honors cancellation before preparation and installation", async () => {
    const { root, destination } = await fixture();
    const source = await file(root);
    const controller = new AbortController();
    const prepared = await prepareMainProjectInputs([source], controller.signal);
    controller.abort();
    await expect(prepared!.install(destination)).rejects.toThrow();
    await expect(prepareMainProjectInputs([source], controller.signal)).rejects.toThrow();
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it("bounds the file count inside a directory", async () => {
    const { root } = await fixture();
    const directory = path.join(root, "many");
    await fs.mkdir(directory);
    await Promise.all(Array.from({ length: 1001 }, (_, i) => file(directory, `${i}.txt`, "")));
    await expect(prepareMainProjectInputs([directory])).rejects.toThrow(/1000 files/);
  });

  it("rejects a destination root junction and a regular file used as a target parent", async () => {
    const { root, destination } = await fixture();
    const source = await file(root);
    const prepared = await prepareMainProjectInputs([{ path: source, name: "parent/child.txt" }]);
    await file(destination, "parent", "keep");
    await expect(prepared!.install(destination)).rejects.toThrow(/ordinary directories/);
    expect(await fs.readFile(path.join(destination, "parent"), "utf8")).toBe("keep");
    const link = path.join(root, "linked-destination");
    await fs.symlink(destination, link, process.platform === "win32" ? "junction" : "dir");
    await expect(prepared!.install(link)).rejects.toThrow(/ordinary directories/);
  });
});
