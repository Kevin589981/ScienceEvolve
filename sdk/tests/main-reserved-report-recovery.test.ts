import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollaborationStateDatabase } from "../src/core/collaboration-state/store.js";
import { ScopedProjectRuntime } from "../src/core/scoped-project-runtime.js";
import { mainRouteTargetInstructions } from "../src/core/collaboration-runtime.js";

// Focused SQL/projection fixture: no model, provider or existing runtime data.
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const sql = new DatabaseSync(":memory:"); databases.push(sql);
  sql.exec(`CREATE TABLE scoped_agent_turns (execution_id TEXT, ownership_epoch INTEGER,
    writer_lease_epoch INTEGER, status TEXT, opened_at TEXT, stopped_at TEXT, invocation_id TEXT, runtime_path TEXT);
    CREATE TABLE project_events (seq INTEGER PRIMARY KEY, project_id TEXT, request_id TEXT,
    invocation_id TEXT, event_type TEXT, payload_json TEXT);`);
  const runtime = path.resolve("fixture/runtime/repair");
  sql.prepare("INSERT INTO scoped_agent_turns VALUES ('execution',1,3,'reserved',NULL,NULL,'repair',?)").run(runtime);
  const execution = { id: "execution", ownershipEpoch: 1, agentId: "review", groupRunId: "group",
    arrivalRequestId: "arrival", status: "running" };
  const coordination = { invocationId: "manager", callId: "retry", stateVersion: 2,
    action: { tool: "coordinate_group_task", operation: "retry", arrivalRequestId: "arrival" } };
  const previousTurn = { projectId: "project", executionId: "execution", ownershipEpoch: 1,
    invocationId: "original", runtimePath: path.join(path.dirname(runtime), "original"),
    baseCommit: "a".repeat(40), status: "stopped", stoppedAt: "old-stop", openedAt: "old-open" };
  const insert = (requestId: string, invocationId: string, type: string, payload: unknown) => sql.prepare(
    "INSERT INTO project_events(project_id,request_id,invocation_id,event_type,payload_json) VALUES ('project',?,?,?,?)"
  ).run(requestId, invocationId, type, JSON.stringify(payload));
  insert("reservation", "repair", "scoped.agent.missing_report_repair.requested", {
    executionId: "execution", ownershipEpoch: 1, runtimePath: runtime, originalInvocationId: "original",
    previousTurn, attempt: 1, coordination
  });
  insert("scoped-leader-action:manager:retry", "manager", "action", {
    executionId: "execution", failedOwnershipEpoch: 1, envelope: coordination
  });
  const manager = { invocationId: "manager", status: "released", coordinatorEpoch: 2 };
  const db = Object.create(CollaborationStateDatabase.prototype);
  Object.assign(db, {
    database: sql, lease: { epoch: 5 }, isoNow: () => "new-stop",
    mutateProject: (_: unknown, __: unknown, callback: (head: unknown) => unknown) => {
      sql.exec("BEGIN"); try { const value = callback({}); sql.exec("COMMIT"); return value; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
    scopedExecution: () => execution,
    scopedAgentTurn: () => {
      const row = sql.prepare("SELECT * FROM scoped_agent_turns").get()!;
      return { ...previousTurn, invocationId: row.invocation_id, runtimePath: row.runtime_path,
        writerLeaseEpoch: row.writer_lease_epoch, status: row.status, openedAt: row.opened_at, stoppedAt: row.stopped_at };
    },
    eventByRequestId: (_: unknown, requestId: string) => {
      const row = sql.prepare("SELECT payload_json FROM project_events WHERE request_id=?").get(requestId);
      return row && { payload: JSON.parse(String(row.payload_json)) };
    },
    scopedLeaderTurns: () => [manager], scopedGroupRun: () => ({ workflowRevision: 1 }),
    scopedAgentReport: vi.fn(() => undefined), scopedAgentTaskCompletion: vi.fn(() => undefined), projectCancellationIntent: vi.fn(() => undefined),
    scopedGroupHierarchyActive: vi.fn(() => true),
    insertEvent: (_: unknown, event: any) => insert(event.requestId, event.invocationId, event.type, event.payload)
  });
  const input = { projectId: "project", executionId: "execution", ownershipEpoch: 1, invocationId: "repair",
    residentStopConfirmed: true as const, evidence: { protocol: "scoped-supervisor-stop-v1", projectId: "project",
      scopeId: "execution", agentId: "review", role: "delivery", ownershipEpoch: 1, runtimePath: runtime,
      nativeProcessScanCleared: true } };
  return { sql, db: db as CollaborationStateDatabase, input, manager, execution };
}

describe("SDK writer restart at an authorized missing-report reservation", () => {
  it.each(["reserved", "stopped"])("reclaims a never-opened %s repair without changing its ancestry or epoch", status => {
    const { sql, db, input } = fixture();
    sql.prepare("UPDATE scoped_agent_turns SET status=?").run(status);
    expect(db.scopedAgentMissingReportRepair("project", "execution", 1)).toBeUndefined();
    db.reconcileScopedAgentTurn(input);
    expect(db.scopedAgentTurn("project", "execution", 1)).toMatchObject({
      ownershipEpoch: 1, writerLeaseEpoch: 5, status: "reserved", openedAt: null, stoppedAt: null
    });
    expect(db.scopedAgentTurn("project", "execution", 1)?.invocationId).not.toBe("repair");
    expect(db.scopedAgentTurn("project", "execution", 1)?.runtimePath).not.toBe(input.evidence.runtimePath);
    expect(db.scopedAgentMissingReportRepair("project", "execution", 1)).toMatchObject({ originalInvocationId: "original", attempt: 1 });
    db.reconcileScopedAgentTurn(input);
    expect(sql.prepare("SELECT count(*) AS n FROM project_events WHERE event_type='scoped.agent.reconciled'").get()!.n).toBe(1);
  });
  it.each(["scopeId", "runtimePath", "nativeProcessScanCleared"])("rejects mismatched %s stop proof without mutating the reservation", key => {
    const { db, input } = fixture();
    expect(() => db.reconcileScopedAgentTurn({ ...input, evidence: { ...input.evidence, [key]: "wrong" } })).toThrow(/exact native owner/);
    expect(db.scopedAgentTurn("project", "execution", 1)).toMatchObject({ writerLeaseEpoch: 3, status: "reserved" });
  });
  it("stops an actually opened repair and keeps recognized lineage for a distinct failure identity", () => {
    const { sql, db, input } = fixture(); sql.exec("UPDATE scoped_agent_turns SET status='active', opened_at='opened'");
    db.reconcileScopedAgentTurn(input);
    expect(db.scopedAgentTurn("project", "execution", 1)).toMatchObject({ status: "stopped", writerLeaseEpoch: 3, stoppedAt: "new-stop" });
    expect(db.scopedAgentMissingReportRepair("project", "execution", 1)).toBeUndefined();
    expect((db as any).scopedMissingReportRepairLineage("project", "execution", 1,
      db.scopedAgentTurn("project", "execution", 1), 3)?.originalInvocationId).toBe("original");
  });
  it.each(["cancelled", "failed", "manager-active", "altered-retry", "reported", "inactive-group", "ordinary-reservation"])("does not reclaim %s", reason => {
    const { sql, db, input, execution, manager } = fixture();
    if (reason === "cancelled") vi.spyOn(db, "projectCancellationIntent").mockReturnValue({} as never);
    if (reason === "failed") execution.status = "failed";
    if (reason === "manager-active") manager.status = "active";
    if (reason === "reported") vi.spyOn(db, "scopedAgentReport").mockReturnValue({} as never);
    if (reason === "inactive-group") (db as any).scopedGroupHierarchyActive.mockReturnValue(false);
    if (reason === "altered-retry") sql.exec("UPDATE project_events SET payload_json='{}' WHERE event_type='action'");
    if (reason === "ordinary-reservation") sql.exec("DELETE FROM project_events WHERE event_type='scoped.agent.missing_report_repair.requested'");
    db.reconcileScopedAgentTurn(input);
    expect(db.scopedAgentTurn("project", "execution", 1)).toMatchObject({ status: "stopped", writerLeaseEpoch: 3 });
  });
  it("does not convert an adopted reservation into another business failure in the runtime", async () => {
    const { db, input, execution } = fixture();
    Object.assign(db, { scopedLeaderTurns: () => [], scopedFinalNativeTurns: () => [],
      projectState: () => ({ scopedExecutions: [execution], scopedGroupRuns: [] }), writerLease: () => ({ epoch: 5 }),
      failScopedAgentArrival: vi.fn() });
    // Keep the real accepted-manager check while the outer runtime has no active leaders.
    const turns = db.scopedLeaderTurns;
    const reconcile = db.reconcileScopedAgentTurn.bind(db);
    db.reconcileScopedAgentTurn = (value) => {
      db.scopedLeaderTurns = () => [{ invocationId: "manager", status: "released", coordinatorEpoch: 2 }] as never;
      try { reconcile(value); } finally { db.scopedLeaderTurns = turns; }
    };
    const runtime = Object.create(ScopedProjectRuntime.prototype);
    Object.assign(runtime, { d: { database: db, state: { id: "project" }, publish: vi.fn(),
      launcher: { stopScopedForRecovery: vi.fn(async () => ({ stopped: true, evidence: input.evidence })) } }, rootNode: () => "root" });
    await runtime.reconcileResidents();
    expect(db.failScopedAgentArrival).not.toHaveBeenCalled();
    expect(db.scopedAgentTurn("project", "execution", 1)?.status).toBe("reserved");
  });
});

describe("same-epoch failure recovery uses the latest physical incident", () => {
  it("does not let an old retry permanently suppress a later missing-report failure", () => {
    const { sql, db } = fixture();
    sql.exec(`CREATE TABLE scoped_executions(project_id TEXT,execution_id TEXT,group_run_id TEXT,
      arrival_request_id TEXT,ownership_epoch INTEGER,status TEXT,created_at TEXT);
      INSERT INTO scoped_executions VALUES ('project','execution','group','arrival',1,'failed','now');`);
    Object.assign(db, { scopedGroupIssues: () => [], scopedGroupRun: () => ({ id: "group" }) });
    const failure = () => sql.prepare("INSERT INTO project_events(project_id,event_type,payload_json) VALUES ('project','scoped.agent.failed',?)")
      .run(JSON.stringify({ executionId: "execution", ownershipEpoch: 1 }));
    const retry = (epoch = 1) => sql.prepare("INSERT INTO project_events(project_id,event_type,payload_json) VALUES ('project','scoped.leader.action.accepted',?)")
      .run(JSON.stringify({ executionId: "execution", failedOwnershipEpoch: epoch, groupRunId: "group",
        envelope: { action: { tool: "coordinate_group_task", operation: "retry" } } }));
    failure(); retry();
    expect(db.scopedRecoveryCandidates("project", "group")[0].pendingOperation).toBe("retry");
    failure();
    expect(db.scopedRecoveryCandidates("project", "group")[0].pendingOperation).toBeUndefined();
    retry(2);
    expect(db.scopedRecoveryCandidates("project", "group")[0].pendingOperation).toBeUndefined();
    retry();
    expect(db.scopedRecoveryCandidates("project", "group")[0].pendingOperation).toBe("retry");
  });
});

describe("scoped same-task supplements include formal business routing", () => {
  async function missing(decisionBy = "agent", route?: string, reportRepair?: unknown) {
    const runtime = new ScopedProjectRuntime({ state: { id: "project", agents: { review: { decisionBy } } },
      database: { initializeScopedConfiguration: () => {}, scopedAgentTaskCompleted: () => true,
        scopedAgentReport: () => undefined, scopedAgentRecordedDeliveryPull: () => undefined,
        projectState: () => ({ operations: [] }) },
      storage: { projectDir: () => "fixture" },
      git: { observeExecutionWorktree: async (execution: any) => ({ executionId: execution.id,
        ownershipEpoch: execution.ownershipEpoch, branch: execution.executionBranch, worktreePath: execution.worktreePath, pendingPaths: [] }) }
    } as never);
    Object.assign(runtime, {
      agentGitFacts: new Map([["turn", { pushedHeadSha: "head", pullRequest: {
        headSha: "head", ownerExecutionId: "execution", status: "merged", mergeCommitSha: "merged-head" },
        merged: { headSha: "head", status: "merged", localSynchronization: {} } }]]),
      capabilities: new Map([["turn", { accepted: [], retained: route ? [{ action: { tool: "route_to_agent", target: route } }] : [] }]]) });
    // Exercise the production resident composition, including current-head Git
    // observations and the new closing check, without launching a native model.
    return (runtime as any).runtime.agents.invoker.composition.missingActions({ invocationId: "turn",
      execution: { id: "execution", ownershipEpoch: 1, agentId: "review", executionBranch: "branch", worktreePath: "fixture" },
      arrival: { targetNodeId: "audit" }, workflow: { routes: { audit: [{ kind: "weak", target: "repair" }, { kind: "weak", target: "finish" }] } },
      reportRepair });
  }
  it("asks the actual Agent for a missing formal weak decision even when all Git tools finished", async () => {
    expect(await missing()).toEqual(["route_to_agent (repair, finish)"]);
  });
  it.each(["repair", "finish"])("does not supplement an already retained %s route", async target => expect(await missing("agent", target)).toEqual([]));
  it("does not require an Agent to override Main-owned routing", async () => expect(await missing("main")).toEqual([]));
  it("preserves the immutable report's original route in a mechanism repair", async () =>
    expect(await missing("agent", undefined, { report: { selectedWeakTarget: "finish" } })).toEqual([]));
});

describe("Main terminal routing and explicit bounded user recovery", () => {
  it("shows the group terminal target and its actual authorized tool", () => {
    expect(mainRouteTargetInstructions(false, ["finish"]).join("\n")).toContain("Allowed route targets: finish.");
    expect(mainRouteTargetInstructions(false, ["finish"]).join("\n")).toContain("route_to_agent with target finish");
    expect(mainRouteTargetInstructions(true, ["finish"]).join("\n")).toContain("use complete_project");
    expect(mainRouteTargetInstructions(false, ["repair"]).join("\n")).not.toContain("authorized workflow terminal");
    expect(mainRouteTargetInstructions(false, []).join("\n")).toBe("Allowed route targets: none.");
  });
  function userRetryFixture() {
    const sql = new DatabaseSync(":memory:"); databases.push(sql);
    sql.exec(`CREATE TABLE project_events(seq INTEGER PRIMARY KEY, project_id TEXT, node_run_id TEXT,
      agent_id TEXT, coordinator_epoch INTEGER, event_type TEXT, payload_json TEXT);
      CREATE TABLE project_heads(project_id TEXT, frozen INTEGER, active_node_run_id TEXT, freeze_reason TEXT,
        freeze_expected_json TEXT, workflow_revision INTEGER, recovery_attempts INTEGER, recovery_limit INTEGER);
      CREATE TABLE node_runs(node_run_id TEXT,node_id TEXT,status TEXT,failure_reason TEXT,updated_at TEXT);
      INSERT INTO node_runs VALUES ('n','main','paused',NULL,NULL);`);
    sql.prepare("INSERT INTO project_heads VALUES ('p',1,'n','main_route_failed',?,1,0,2)")
      .run(JSON.stringify({ activeNodeRunId: "n", nodeRunId: "n", workflowRevision: 1 }));
    const insert = (type: string, payload: unknown, epoch = 3) => sql.prepare(
      "INSERT INTO project_events(project_id,node_run_id,agent_id,coordinator_epoch,event_type,payload_json) VALUES ('p','n','main',?,?,?)"
    ).run(epoch, type, JSON.stringify(payload));
    insert("main.route.mechanism_repair.requested", {});
    insert("main.route.mechanism_repair.requested", {});
    insert("main.route.failed.frozen", {});
    const db = Object.create(CollaborationStateDatabase.prototype) as CollaborationStateDatabase;
    Object.assign(db, { database: sql, requiredNode: () => sql.prepare("SELECT * FROM node_runs").get(),
      assertOpen: vi.fn(), isoNow: () => "now",
      mutateProject: (_: unknown, __: unknown, callback: (head: unknown) => any) => {
        sql.exec("BEGIN");
        try { const result = callback(sql.prepare("SELECT * FROM project_heads").get()); sql.exec("COMMIT"); return { ...result, revision: 1 }; }
        catch (error) { sql.exec("ROLLBACK"); throw error; }
      },
      insertEvent: (_: unknown, event: any) => insert(event.type, event.payload, event.coordinatorEpoch)
    });
    const input = { projectId: "p", nodeRunId: "n", routeEpoch: 3, explicitUserResume: true, priorProcessStopped: true };
    return { db, sql, input, insert };
  }
  it("atomically renews an exhausted cycle on explicit stopped Resume and never on its replay", () => {
    const { db, sql, input, insert } = userRetryFixture();
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(2);
    expect(db.recoverMainRoute(input).recovered).toBe(true);
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(0);
    expect(sql.prepare("SELECT frozen FROM project_heads").get()!.frozen).toBe(0);
    insert("main.route.mechanism_repair.requested", {});
    insert("main.route.mechanism_repair.requested", {});
    expect(db.recoverMainRoute(input).recovered).toBe(true);
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(2);
    expect(sql.prepare("SELECT count(*) AS n FROM project_events WHERE event_type='main.route.mechanism_repair.requested'").get()!.n).toBe(4);
    expect(sql.prepare("SELECT count(*) AS n FROM project_events WHERE event_type='main.route.recovered' AND json_extract(payload_json,'$.mechanismRepairBudgetRenewed')=1").get()!.n).toBe(1);
  });
  it("renews an exhausted automatic recovery only after exact native stop confirmation", () => {
    const { db, sql, input } = userRetryFixture();
    input.explicitUserResume = false;
    expect(db.recoverMainRoute(input).recovered).toBe(true);
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(0);
    const event = sql.prepare("SELECT payload_json FROM project_events WHERE event_type='main.route.recovered'").get()!;
    expect(JSON.parse(String(event.payload_json))).toMatchObject({ automaticRecovery: true, mechanismRepairBudgetRenewed: true });
  });
  it.each(["wrong-epoch", "unconfirmed-stop", "not-frozen", "wrong-owner", "wrong-freeze"])("does not renew for %s", reason => {
    const { db, sql, input } = userRetryFixture();
    if (reason === "wrong-epoch") input.routeEpoch++;
    if (reason === "unconfirmed-stop") input.priorProcessStopped = false;
    if (reason === "not-frozen") sql.exec("UPDATE project_heads SET frozen=0");
    if (reason === "wrong-owner") sql.exec("UPDATE project_heads SET active_node_run_id='foreign'");
    if (reason === "wrong-freeze") sql.exec("UPDATE project_heads SET freeze_reason='group_failure'");
    if (reason === "wrong-freeze") expect(() => db.recoverMainRoute(input)).toThrow(/independent Main route/);
    else db.recoverMainRoute(input);
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(2);
  });
  it("rolls back the unfreeze when writing its durable renewal receipt fails", () => {
    const { db, sql, input } = userRetryFixture();
    vi.spyOn(db as any, "insertEvent").mockImplementation(() => { throw new Error("receipt failure"); });
    expect(() => db.recoverMainRoute(input)).toThrow("receipt failure");
    expect(sql.prepare("SELECT frozen FROM project_heads").get()!.frozen).toBe(1);
    expect(sql.prepare("SELECT status FROM node_runs").get()!.status).toBe("paused");
    expect(db.mainRouteControlRepairCount("p", "n")).toBe(2);
  });
});
