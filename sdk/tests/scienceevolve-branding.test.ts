import { describe, expect, it } from "vitest";
import { brandBytes, unbrandBytes, renameText, renamePath } from "../scripts/scienceevolve-branding.mjs";

// Exact old-name fixtures prove conversion priority and reversible provenance.
const legacyNamingFixture = "SCION-AR SCION_AR ScionAR ScionAr scionAr scion-ar scion_ar scionar scion-name scion_tool SCION Scion scionFunction scion";
const unicodeLegacyFixture = "中文😀 SCION_AR_DEBUG scionOne .scion-ar 🧪";
const legacySkillPath = "skills/scion-ar-sdk/SKILL.md";
const legacyArisSkillPath = "skills/scion-aris/SKILL.md";

describe("ScienceEvolve branding provenance", () => {
  it("applies the public naming policy with stable priority and path spelling", () => {
    expect(renameText(legacyNamingFixture)).toBe("ScienceEvolve SCIENCEEVOLVE ScienceEvolve ScienceEvolve scienceEvolve scienceevolve scienceevolve scienceevolve scienceevolve-name scienceevolve_tool SCIENCEEVOLVE ScienceEvolve scienceEvolveFunction scienceevolve");
    expect(renamePath(legacySkillPath)).toBe("skills/scienceevolve-sdk/SKILL.md");
    expect(renamePath(legacyArisSkillPath)).toBe("skills/scienceevolve-aris/SKILL.md");
  });

  it("round-trips Unicode offsets while preserving pre-existing new names", () => {
    const original = Buffer.from(unicodeLegacyFixture + " Already ScienceEvolve / scienceevolve / scienceEvolve");
    const branded = brandBytes(original);
    expect(unbrandBytes(branded.bytes, branded.edits)).toEqual(original);
    expect(branded.bytes.toString()).toBe("中文😀 SCIENCEEVOLVE_DEBUG scienceEvolveOne .scienceevolve 🧪 Already ScienceEvolve / scienceevolve / scienceEvolve");
    expect(renameText(branded.bytes.toString())).toBe(branded.bytes.toString());
  });

  it("rejects shifted edits, missing edits, target drift and invalid UTF-8", () => {
    const branded = brandBytes(Buffer.from(legacyNamingFixture));
    const shifted = structuredClone(branded.edits);
    shifted[0].offset++;
    expect(() => unbrandBytes(branded.bytes, shifted)).toThrow(/context drift/);
    expect(() => unbrandBytes(branded.bytes, branded.edits.slice(1))).toThrow(/drift/);
    expect(() => unbrandBytes(Buffer.from(branded.bytes.toString().replace("SCIENCEEVOLVE", "changed")), branded.edits)).toThrow(/context drift/);
    expect(() => brandBytes(Buffer.from([0xff]))).toThrow(/valid UTF-8/);
  });
});
