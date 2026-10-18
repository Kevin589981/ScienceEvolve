import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveMainCapabilities,
  SHARED_RUNTIME_EVENT_NAMES,
  type MainCapabilityInput,
  type MainCapabilitySnapshot
} from "../src/core/internal/shared/contracts.js";

interface FixtureCase extends MainCapabilityInput {
  expected: MainCapabilitySnapshot;
}

const fixture = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", "shared-contracts.json"), "utf8")
) as Record<string, FixtureCase>;
const manifest = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../resources/main-runtime/manifest.json"), "utf8")
) as { files: Array<{ target: string; sha256: string }> };

describe("shared host contracts", () => {
  for (const [name, testCase] of Object.entries(fixture)) {
    it(`derives the ${name} capability snapshot`, () => {
      const { expected, ...input } = testCase;
      expect(deriveMainCapabilities(input)).toEqual(expected);
    });
  }

  it("keeps the published loop and reconfiguration event names stable", () => {
    expect(SHARED_RUNTIME_EVENT_NAMES).toEqual([
      "workflow.loop.batch.started",
      "workflow.loop.iteration",
      "workflow.loop.exhausted",
      "workflow.reconfigured"
    ]);
  });

  it("keeps shared main modules pinned to the independently verified runtime manifest", () => {
    const entries = manifest.files.filter(entry => entry.target.startsWith("src/core/internal/shared/"));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const source = fs.readFileSync(path.join(import.meta.dirname, "..", entry.target), "utf8").replaceAll("\r\n", "\n");
      expect(createHash("sha256").update(source).digest("hex"), entry.target).toBe(entry.sha256);
    }
  });
});
