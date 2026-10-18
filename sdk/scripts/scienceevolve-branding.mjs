import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// These exact old tokens are migration rules and provenance, never runtime
// identifiers. Preserve their spelling so imported upstream bytes can be proved.
const replacements = new Map([
  ["SCION-AR", "ScienceEvolve"], ["SCION_AR", "SCIENCEEVOLVE"],
  ["ScionAR", "ScienceEvolve"], ["ScionAr", "ScienceEvolve"],
  ["scionAr", "scienceEvolve"], ["scion-ar", "scienceevolve"],
  ["scion_ar", "scienceevolve"], ["scionar", "scienceevolve"],
  ["scion-", "scienceevolve-"], ["scion_", "scienceevolve_"],
  ["SCION", "SCIENCEEVOLVE"], ["Scion", "ScienceEvolve"]
]);
const pattern = /SCION-AR|SCION_AR|ScionAR|ScionAr|scionAr|scion-ar(?![a-z])|scion_ar|scionar|scion-|scion_|SCION|Scion|scion/g;
const moduleBytes = await readFile(new URL(import.meta.url));
export const brandingDigest = createHash("sha256").update(moduleBytes).digest("hex");
export const brandingVersion = "scienceevolve-v1";

/** One deterministic pass, equivalent to the ordered naming policy. */
export function renameText(input) {
  return transform(input).text;
}
export function renamePath(input) { return renameText(input); }

function transform(text) {
  const edits = [];
  const output = text.replace(pattern, (before, offset) => {
    const after = replacements.get(before) ??
      (/[A-Z]/.test(text[offset + before.length] ?? "") ? "scienceEvolve" : "scienceevolve");
    edits.push({ offset, before, after });
    return after;
  });
  return { text: output, edits };
}

/** Keep exact original UTF-16 text offsets; no guessed global reverse mapping. */
export function brandBytes(bytes) {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error("Branding requires valid UTF-8 source bytes");
  const transformed = transform(text);
  return { bytes: Buffer.from(transformed.text), edits: transformed.edits };
}

/** Reverse exact recorded edits, then prove that the current policy replays them. */
export function unbrandBytes(bytes, edits) {
  if (!Array.isArray(edits)) throw new Error("Missing runtime branding provenance");
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) throw new Error("Branding requires valid UTF-8 target bytes");
  let original = "", cursor = 0, delta = 0, originalEnd = 0;
  for (const edit of edits) {
    if (!edit || !Number.isSafeInteger(edit.offset) || edit.offset < originalEnd ||
      typeof edit.before !== "string" || typeof edit.after !== "string" ||
      !edit.before || !edit.after || edit.before === edit.after) throw new Error("Invalid runtime branding edit");
    const position = edit.offset + delta;
    if (position < cursor || text.slice(position, position + edit.after.length) !== edit.after)
      throw new Error("Runtime branding context drift at " + edit.offset);
    original += text.slice(cursor, position) + edit.before;
    cursor = position + edit.after.length;
    originalEnd = edit.offset + edit.before.length;
    delta += edit.after.length - edit.before.length;
  }
  original += text.slice(cursor);
  const replay = transform(original);
  if (replay.text !== text || JSON.stringify(replay.edits) !== JSON.stringify(edits))
    throw new Error("Runtime branding policy/provenance drift");
  return Buffer.from(original);
}
