import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { CollaborationStateDatabase } from "../src/core/collaboration-state/store.js";
import type { ScopedFinalNativeTurn } from "../src/core/collaboration-state/contracts.js";

// Simulated immutable S facts; exercise the actual production proof validator.
// Actual Git/SQLite recovery is covered separately and not claimed by this test.
function fixture(previousStatus: "stopped" | "opened" = "stopped") {
  const runtime = path.join(os.tmpdir(), "scienceevolve-final-proof");
  const current: ScopedFinalNativeTurn = { projectId: "project", executionId: "final", groupRunId: "group", ownershipEpoch: 3,
    agentId: "execution", invocationId: "inv_new", runtimePath: path.join(runtime, "inv_new"), writerLeaseEpoch: 5, status: "reserved" };
  const previous = { ...current, invocationId: "inv_old", runtimePath: path.join(runtime, "inv_old"), status: previousStatus };
  const assertOwner = vi.fn();
  const store = { immediate: (fn: () => unknown) => fn(), lease: { epoch: 5 },
    scopedFinalNativeTurns: () => [previous, current], scopedFinalIntegration: () => ({ id: "final", ownershipEpoch: 3, executionBranch: "groups/group" }),
    scopedGroupIntegrationRequest: () => ({ integrationOwnerAgentId: "execution" }), currentScopedFinalGitOwner: assertOwner };
  const validate = (input = current) => CollaborationStateDatabase.prototype.assertScopedFinalNativeReopenLaunch.call(store as never, input);
  return { current, previous, store, assertOwner, validate };
}
describe("canonical final task supplemental-open authority", () => {
  it("returns only the stopped same-task lineage under the current writer, without advancing the owner", () => {
    const f = fixture(); expect(f.validate()).toEqual({ previousRuntimePath: f.previous.runtimePath });
    expect(f.assertOwner).toHaveBeenCalledWith(expect.objectContaining({ executionId: "final", ownershipEpoch: 3, operation: "provider.mutate" }));
    expect(f.current.ownershipEpoch).toBe(3);
  });
  it("rejects live originals, changed identities, stale writers and changed runtime paths", () => {
    expect(() => fixture("opened").validate()).toThrow(/stopped original/);
    for (const patch of [{ agentId: "other" }, { executionId: "other" }, { ownershipEpoch: 2 }, { groupRunId: "other" }, { runtimePath: path.join(os.tmpdir(), "other") }]) {
      const f = fixture(); expect(() => f.validate({ ...f.current, ...patch })).toThrow(/reservation/);
    }
    const f = fixture(); f.store.lease.epoch = 6; expect(() => f.validate()).toThrow(/current-writer/);
  });
  it("does not invent a supplemental proof for an initial launch or bypass Git ownership validation", () => {
    const f = fixture(); f.store.scopedFinalNativeTurns = () => [f.current]; expect(f.validate()).toBeUndefined();
    f.assertOwner.mockImplementation(() => { throw new Error("Git owner revoked"); }); expect(() => f.validate()).toThrow(/revoked/);
  });
});
