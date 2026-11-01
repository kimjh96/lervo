import type { OperatingMandateV3, InstalledOperatingMandate } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";
import {
  assertOperatingMandate,
  assertMandateExecutionSuccession,
  observeOperatingWorkScope,
  operatingWorkScopeEventTypes,
  selectOperatingWorkScope,
  operatingContractHash,
  projectWorkstreamResources,
} from "../src/index.js";
import { assignment, causalityPayload, event, projectId, workstreamId } from "./fixtures.js";
import { mandate as baseMandate, hash } from "./operating-supervision.fixture.js";

function fixture() {
  const prior = assignment("a", { status: "failed", failureCode: "user_cancelled" });
  const anchor = event(10, "workstream.snapshot.recorded", "run_scope", {
    workstreamId,
    snapshotContentHash: hash(),
  });
  anchor.eventId = `evt_${"a".repeat(32)}`;
  const scope: OperatingMandateV3["workScope"] = {
    schemaVersion: 1,
    workstreamId,
    snapshotEventId: anchor.eventId,
    snapshotEventHash: anchor.eventHash,
    excludedAssignments: [
      { assignmentId: prior.assignmentId, contentHash: operatingContractHash(prior) },
    ],
  };
  const input = { scope, projectId, workstreamId, assignments: [prior], events: [anchor] };
  const mandate: OperatingMandateV3 = {
    ...baseMandate(),
    schemaVersion: 3,
    executionAuthority: { schemaVersion: 1, mode: "designated_host", hostIdentityHash: hash() },
    workScope: scope,
  };
  return { prior, anchor, scope, input, mandate };
}

describe("reviewed operating work scope", () => {
  it("accepts an explicitly reviewed repository-wide path root", () => {
    const f = fixture();
    expect(() => assertOperatingMandate({ ...f.mandate, pathRoots: ["*"] })).not.toThrow();
  });

  it("preserves the exact failed predecessor and observes only newly created work", () => {
    const f = fixture();
    const current = assignment("b", { createdAt: "2026-09-01T00:00:11.000Z" });
    f.input.assignments.push(current);
    const before = JSON.stringify(f.input);
    expect(observeOperatingWorkScope(f.input)).toEqual({
      anchor: f.anchor,
      assignments: [current],
      historicalAssignments: [f.prior],
    });
    expect(JSON.stringify(f.input)).toBe(before);
    expect(() => assertOperatingMandate(f.mandate)).not.toThrow();
  });

  it("selects the newest safe anchor before unresolved prior work", () => {
    const f = fixture();
    const active = assignment("b", {
      status: "queued",
      createdAt: "2026-09-01T00:00:11.000Z",
      updatedAt: "2026-09-01T00:00:11.000Z",
    });
    const later = event(12, "workstream.snapshot.recorded", "run_scope_later", {
      workstreamId,
      snapshotContentHash: hash("2"),
    });
    later.eventId = `evt_${"b".repeat(32)}`;
    const selected = selectOperatingWorkScope({
      projectId,
      workstreamId,
      events: [f.anchor, later],
      assignments: [f.prior, active],
    });
    expect(selected).toEqual(f.scope);
    expect(() =>
      selectOperatingWorkScope({
        projectId,
        workstreamId,
        events: [later],
        assignments: [active],
      }),
    ).toThrow(/No canonical workstream snapshot/iu);
  });

  it.each(["changed_hash", "active", "live_lease", "handoff", "omitted", "dependency", "anchor"])(
    "rejects a %s boundary",
    (condition) => {
      const f = fixture();
      if (condition === "changed_hash") f.prior.revision++;
      if (condition === "active") f.prior.status = "queued";
      if (condition === "live_lease")
        f.prior.lease = {
          leaseId: "lease_fixture",
          agentId: `agt_${"a".repeat(24)}`,
          sessionId: "ses_fixture0001",
          acquiredAt: "2026-09-01T00:00:00.000Z",
          expiresAt: "2026-09-01T00:01:00.000Z",
          generation: 1,
        };
      if (condition === "handoff") f.prior.handoffs.push({} as never);
      if (condition === "omitted") f.scope.excludedAssignments = [];
      if (condition === "dependency")
        f.input.assignments.push(
          assignment("b", {
            dependencyIds: [f.prior.assignmentId],
            createdAt: "2026-09-01T00:00:11.000Z",
          }),
        );
      if (condition === "anchor") f.scope.snapshotEventHash = hash("f");
      if (["active", "live_lease", "handoff"].includes(condition))
        f.scope.excludedAssignments[0]!.contentHash = operatingContractHash(f.prior);
      expect(() => observeOperatingWorkScope(f.input)).toThrow(/scope|historical/iu);
    },
  );

  it("requires every prior causal descendant and supervision decision to settle", () => {
    const f = fixture();
    const causal = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    f.input.events.unshift(event(1, "work.causality.recorded", "run_prior0001", causal));
    expect(() => observeOperatingWorkScope(f.input)).toThrow(/unfinished/iu);
    f.input.events.splice(1, 0, event(2, "run.failed", "run_prior0001", {}));
    expect(() => observeOperatingWorkScope(f.input)).not.toThrow();
    const child = event(6, "work.causality.recorded", "run_child0001", {
      ...causal,
      relationship: "subagent",
      parentRunId: "run_prior0001",
    });
    f.input.events.splice(2, 0, child);
    expect(() => observeOperatingWorkScope(f.input)).toThrow(/unfinished/iu);
    f.input.events.splice(3, 0, event(7, "run.completed", "run_child0001", {}));
    expect(() => observeOperatingWorkScope(f.input)).not.toThrow();
    f.input.events.splice(
      2,
      0,
      event(3, "work.supervision.decision.recorded", "run_owner", {
        workstreamId,
        decisionId: "d",
      }),
      event(4, "work.supervision.effect.observed", "run_owner", {
        workstreamId,
        decisionId: "d",
        status: "uncertain",
      }),
    );
    expect(() => observeOperatingWorkScope(f.input)).toThrow(/unsettled/iu);
    f.input.events.splice(
      4,
      0,
      event(5, "work.supervision.decision.superseded", "run_owner", {
        workstreamId,
        decisionId: "d",
      }),
    );
    expect(() => observeOperatingWorkScope(f.input)).not.toThrow();
    f.input.events.find((event) => event.type === "run.completed")!.seq = 11;
    expect(() => observeOperatingWorkScope(f.input)).toThrow(/unfinished/iu);
  });

  it("answers from its declared event types exactly as from the complete history", () => {
    const f = fixture();
    const causal = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    const decision = { workstreamId, decisionId: "d" };
    const supervised = assignment("s", { status: "completed" });
    f.input.events.unshift(
      event(1, "work.causality.recorded", "run_prior0001", causal),
      event(2, "run.requested", "run_prior0001", {}),
      event(3, "run.failed", "run_prior0001", {}),
      event(4, "work.supervision.decision.recorded", "run_owner", decision),
      event(5, "work.supervision.effect.observed", "run_owner", {
        ...decision,
        status: "effect_confirmed",
      }),
      event(6, "work.supervision.bound", "run_owner", { assignmentId: supervised.assignmentId }),
      event(7, "deliberation.completed", "run_other", {}),
    );
    const outcome = (events: typeof f.input.events) => {
      try {
        return observeOperatingWorkScope({ ...f.input, events });
      } catch (error) {
        return (error as Error).message;
      }
    };
    const declared = (events: typeof f.input.events) =>
      events.filter((item) => operatingWorkScopeEventTypes.includes(item.type));
    expect(outcome(f.input.events)).not.toBeTypeOf("string");
    expect(outcome(declared(f.input.events))).toEqual(outcome(f.input.events));
    // Each required type still changes the answer after unrelated events are removed.
    for (const removed of [3, 5]) {
      const without = f.input.events.filter((item) => item.seq !== removed);
      expect(outcome(declared(without))).toEqual(outcome(without));
      expect(outcome(without)).toBeTypeOf("string");
    }
  });

  it("keeps all new causal descendants in the scoped budget without rewriting prior usage", () => {
    const f = fixture();
    const prior = { ...causalityPayload({ assignmentId: "unused" }), assignmentId: null };
    const next = { ...prior, workId: `wrk_${"2".repeat(24)}` };
    const events = [
      event(1, "work.causality.recorded", "run_prior0001", prior),
      f.anchor,
      event(11, "work.causality.recorded", "run_new000001", next),
      event(12, "work.causality.recorded", "run_child0001", {
        ...next,
        relationship: "publication_evaluation",
        parentRunId: "run_new000001",
      }),
    ];
    expect(projectWorkstreamResources({ events, workstreamId }).runIds).toEqual([
      "run_child0001",
      "run_new000001",
      "run_prior0001",
    ]);
    expect(
      projectWorkstreamResources({
        events,
        workstreamId,
        scopeAnchor: { eventId: f.anchor.eventId, eventHash: f.anchor.eventHash },
      }).runIds,
    ).toEqual(["run_child0001", "run_new000001"]);
  });

  it("rejects duplicate exclusion pins and scope resets through mandate succession", () => {
    const f = fixture();
    const installed: InstalledOperatingMandate = {
      eventId: `evt_${"b".repeat(32)}`,
      mandate: structuredClone(f.mandate),
      mandateHash: operatingContractHash(f.mandate),
      installationReviewHash: hash(),
      sourceRevisionDigest: hash(),
      revoked: true,
      latestEventId: `evt_${"c".repeat(32)}`,
    };
    expect(() => assertMandateExecutionSuccession(installed, f.mandate)).not.toThrow();
    f.mandate.workScope.snapshotEventHash = hash("d");
    expect(() => assertMandateExecutionSuccession(installed, f.mandate)).toThrow(/reset/iu);
    f.mandate.workScope.excludedAssignments.push(f.scope.excludedAssignments[0]!);
    expect(() => assertOperatingMandate(f.mandate)).toThrow(/invalid/iu);
  });
});
