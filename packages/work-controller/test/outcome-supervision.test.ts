import type {
  OutcomeSupervisionSnapshotV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import { describe, expect, it } from "vitest";
import { principalEscalationBoundMs, projectOutcomeSupervision } from "../src/index.js";
import { hash, now, owner, responsibility } from "./operating-supervision.fixture.js";

function assignment(): SupervisedAssignmentObservationV1 {
  const task = responsibility();
  return {
    assignmentId: task.assignmentId,
    revision: 1,
    executorAgentId: task.executorAgentId,
    acceptanceOwnerAgentId: owner,
    responsibilityArtifactHash: hash(),
    status: "queued",
    dispatchedAt: null,
    startedAt: null,
    startDeadline: task.startDeadline,
    progressDeadline: task.progressDeadline,
    completionDeadline: task.completionDeadline,
    terminalEventId: null,
    effectDisposition: "not_started",
    recoveryDecisionCount: 0,
    artifactHashes: [],
    requiredVerificationSuiteIds: ["save.restart"],
    verification: [],
    review: null,
    acceptanceHash: hash("b"),
  };
}
function snapshot(): OutcomeSupervisionSnapshotV1 {
  return {
    schemaVersion: 1,
    supervisionId: "supervision.project",
    projectId: `prj_${"a".repeat(16)}`,
    workstreamId: `wks_${"a".repeat(24)}`,
    workstreamRevision: 1,
    sourceRevisionDigest: hash(),
    ownerAgentId: owner,
    mandateHash: hash("b"),
    causationEventIds: [`evt_${"a".repeat(32)}`],
    evidenceStatus: "valid",
    workstreamStatus: "active",
    authorityStatus: "active",
    assignments: [assignment()],
    escalationCount: 0,
    pendingDecision: false,
    delivery: "not_attempted",
  };
}
const project = (state: OutcomeSupervisionSnapshotV1, time = now) =>
  projectOutcomeSupervision({ snapshot: state, now: time, maximumRecoveryDecisions: 3 });
const principal = {
  actionKinds: ["allocate_existing", "revise_responsibility", "escalate"] as const,
  expiresAt: "2026-09-12T00:00:00.000Z",
};
const projectAsPrincipal = (
  state: OutcomeSupervisionSnapshotV1,
  time = now,
  scope: {
    actionKinds: readonly ("allocate_existing" | "revise_responsibility" | "escalate")[];
    expiresAt: string;
  } = principal,
) =>
  projectOutcomeSupervision({
    snapshot: state,
    now: time,
    maximumRecoveryDecisions: 3,
    principal: scope,
  });
function exhaustedFailure(): OutcomeSupervisionSnapshotV1 {
  const state = snapshot();
  const task = state.assignments[0]!;
  task.status = "failed";
  task.effectDisposition = "known_safe_failure";
  task.recoveryDecisionCount = 3;
  return state;
}

describe("causal outcome supervision without a chat surface", () => {
  it("dispatches an exactly claimed responsibility before waiting for worker start", () => {
    const state = snapshot();
    state.assignments[0]!.status = "leased";
    expect(project(state).nextAction).toBe("dispatch");
  });
  it("preserves unbound canonical work during planning and cancellation", () => {
    const state = snapshot();
    const id = state.assignments[0]!.assignmentId;
    state.assignments = [];
    state.unboundAssignmentIds = [id];
    expect(project(state)).toMatchObject({
      reasonCode: "responsibility_installation_required",
      assignmentIds: [id],
      nextAction: "allocate_existing",
    });
    state.workstreamStatus = "cancelled";
    expect(project(state)).toMatchObject({
      reasonCode: "cancellation_unreconciled",
      assignmentIds: [id],
      nextAction: "reconcile_cancellation",
    });
    state.workstreamStatus = "completed";
    expect(project(state).status).toBe("invalid");
    state.unboundAssignmentIds = [id, id];
    expect(() => project(state)).toThrow("snapshot is invalid");
  });
  it("requires dispatch, start and progress evidence separately, and checks persisted deadlines", () => {
    const state = snapshot();
    expect(project(state).nextAction).toBe("dispatch");
    state.assignments[0]!.dispatchedAt = now;
    expect(project(state)).toMatchObject({
      status: "awaiting_start",
      nextAction: null,
      nextCheckAt: responsibility().startDeadline,
    });
    expect(project(state, responsibility().startDeadline)).toMatchObject({
      status: "recovering",
      nextAction: "inspect_uncertain_effect",
    });
    state.assignments[0]!.startedAt = now;
    state.assignments[0]!.status = "leased";
    expect(project(state)).toMatchObject({ status: "executing", nextAction: null });
  });
  it("wakes the accountable owner on a silent failure and bounds safe retries", () => {
    const state = snapshot();
    const task = state.assignments[0]!;
    task.status = "failed";
    task.effectDisposition = "known_safe_failure";
    expect(project(state)).toMatchObject({
      ownerAgentId: owner,
      status: "recovering",
      nextAction: "retry_attempt",
    });
    task.recoveryDecisionCount = 3;
    expect(project(state).nextAction).toBe("escalate");
    task.effectDisposition = "uncertain";
    expect(project(state).nextAction).toBe("inspect_uncertain_effect");
    state.attentionPending = true;
    expect(project(state)).toMatchObject({
      status: "waiting_decision",
      reasonCode: "uncertain_effect_attention_pending",
      nextAction: null,
      assignmentIds: [task.assignmentId],
    });
    state.workstreamStatus = "cancelled";
    expect(project(state).nextAction).toBe("inspect_uncertain_effect");
  });
  it("keeps an exhausted escalation history readable without proposing another escalation", () => {
    const state = snapshot();
    const task = state.assignments[0]!;
    task.status = "failed";
    task.effectDisposition = "known_safe_failure";
    task.recoveryDecisionCount = 3;
    state.escalationCount = 9;
    expect(project(state)).toMatchObject({
      status: "waiting_decision",
      reasonCode: "escalation_capacity_exceeded",
      nextAction: null,
    });
    state.escalationCount = 32_769;
    expect(() => project(state)).toThrow("snapshot is invalid");
  });
  it("lets the principal proxy decide within its mandate at escalation capacity", () => {
    const state = exhaustedFailure();
    state.escalationCount = 8;
    expect(projectAsPrincipal(state)).toMatchObject({
      status: "recovering",
      reasonCode: "principal_proxy_worker_failed",
      nextAction: "revise_responsibility",
    });
    expect(
      projectAsPrincipal(state, now, { actionKinds: ["escalate"], expiresAt: principal.expiresAt }),
    ).toMatchObject({
      status: "lervo_debt",
      reasonCode: "principal_scope_exceeded",
      nextAction: null,
      nextCheckAt: null,
    });
    state.escalationCount = 7;
    expect(projectAsPrincipal(state)).toMatchObject({
      reasonCode: "worker_failed",
      nextAction: "escalate",
    });
  });
  it("keeps owner attention a notice until the bound, then the proxy proceeds", () => {
    const state = exhaustedFailure();
    state.escalationCount = 1;
    state.attentionPending = true;
    state.attentionPendingSince = now;
    const bound = new Date(Date.parse(now) + principalEscalationBoundMs).toISOString();
    expect(projectAsPrincipal(state)).toMatchObject({
      status: "waiting_decision",
      reasonCode: "owner_attention_pending",
      nextAction: null,
      nextCheckAt: bound,
    });
    expect(project(state)).toMatchObject({
      reasonCode: "owner_attention_pending",
      nextCheckAt: null,
    });
    expect(projectAsPrincipal(state, bound)).toMatchObject({
      status: "recovering",
      reasonCode: "principal_proxy_worker_failed",
      nextAction: "revise_responsibility",
    });
    state.assignments[0]!.effectDisposition = "uncertain";
    expect(projectAsPrincipal(state)).toMatchObject({
      reasonCode: "uncertain_effect_attention_pending",
      nextCheckAt: bound,
    });
    expect(projectAsPrincipal(state, bound)).toMatchObject({
      status: "recovering",
      reasonCode: "effect_outcome_uncertain",
      nextAction: "inspect_uncertain_effect",
    });
    state.attentionPending = false;
    expect(() => projectAsPrincipal(state)).toThrow("snapshot is invalid");
    state.attentionPending = true;
    state.attentionPendingSince = "yesterday";
    expect(() => projectAsPrincipal(state)).toThrow("snapshot is invalid");
  });
  it("holds another project's overdue handoff acceptance as Lervo debt past the bound", () => {
    const state = snapshot();
    state.assignments = [];
    state.escalationCount = 8;
    state.handoffs = { pendingIncoming: [], pendingOutgoing: [hash("e")], nextCheckAt: now };
    expect(projectAsPrincipal(state)).toMatchObject({
      status: "lervo_debt",
      reasonCode: "principal_scope_exceeded",
      nextAction: null,
      nextCheckAt: null,
    });
  });
  it("rejects provider exit and lint as acceptance, binds reviews to exact artifacts and separates delivery", () => {
    const state = snapshot();
    const task = state.assignments[0]!;
    task.status = "completed";
    task.effectDisposition = "reconciled";
    task.terminalEventId = `evt_${"b".repeat(32)}`;
    expect(project(state).nextAction).toBe("review_artifacts");
    task.artifactHashes = [hash("c")];
    task.verification = [
      {
        suiteId: "save.restart",
        eventId: `evt_${"c".repeat(32)}`,
        artifactHashes: [hash("c")],
        status: "passed",
      },
    ];
    task.review = {
      verdict: "accepted",
      reviewerAgentId: owner,
      acceptanceHash: task.acceptanceHash,
      artifactHashes: task.artifactHashes,
      verificationEventIds: [task.verification[0]!.eventId],
    };
    expect(project(state).nextAction).toBe("complete_workstream");
    state.handoffs = {
      pendingIncoming: [],
      pendingOutgoing: [hash("e")],
      nextCheckAt: responsibility().completionDeadline,
    };
    expect(project(state).reasonCode).toBe("scoped_handoff_acceptance_pending");
    expect(project(state).nextAction).toBeNull();
    state.handoffs.pendingOutgoing = [];
    state.handoffs.nextCheckAt = null;
    expect(project(state).nextAction).toBe("complete_workstream");
    state.workstreamStatus = "completed";
    state.deliveryRequired = false;
    expect(project(state)).toMatchObject({
      status: "completed",
      reasonCode: "accepted_local_result_available",
      nextAction: null,
    });
    state.delivery = "pending";
    expect(project(state).reasonCode).toBe("accepted_delivery_queued");
    state.delivery = "failed";
    expect(project(state)).toMatchObject({ status: "completed", nextAction: "publish_result" });
    state.deliveryNextCheckAt = null;
    expect(project(state).reasonCode).toBe("result_delivery_recovery_exhausted");
    state.deliveryRecoverySafe = true;
    expect(project(state)).toMatchObject({
      status: "reviewing",
      reasonCode: "result_delivery_recovery_safe",
      nextAction: "publish_result",
    });
    state.deliveryRecoverySafe = false;
    state.delivery = "delivered";
    expect(project(state).nextAction).toBeNull();
    task.artifactHashes = [hash("d")];
    expect(project(state).status).not.toBe("completed");
  });
  it("routes a current blocked owner review instead of repeatedly requesting the same review", () => {
    const state = snapshot();
    const task = state.assignments[0]!;
    task.status = "completed";
    task.effectDisposition = "reconciled";
    task.terminalEventId = `evt_${"b".repeat(32)}`;
    task.artifactHashes = [hash("c")];
    task.review = {
      verdict: "blocked",
      reviewerAgentId: owner,
      acceptanceHash: task.acceptanceHash,
      artifactHashes: [...task.artifactHashes],
      verificationEventIds: [],
    };
    expect(project(state)).toMatchObject({
      status: "waiting_decision",
      reasonCode: "acceptance_blocked",
      nextAction: "escalate",
    });
    task.artifactHashes = [hash("d")];
    expect(project(state).nextAction).toBe("review_artifacts");
  });
  it("does not hide corrupt evidence or claim cancellation while a worker may still be running", () => {
    const state = snapshot();
    state.evidenceStatus = "conflict";
    expect(project(state)).toMatchObject({ status: "invalid", nextAction: null });
    state.evidenceStatus = "valid";
    state.workstreamStatus = "cancelled";
    expect(project(state).nextAction).toBe("reconcile_cancellation");
    state.assignments[0]!.status = "cancelled";
    expect(project(state).status).toBe("cancelled");
  });
  it("installs an existing replacement for an exhausted rework instead of escalating again", () => {
    const state = snapshot();
    state.assignments[0]!.recoveryDecisionCount = 3;
    state.assignments[0]!.review = {
      verdict: "rework",
      reviewerAgentId: owner,
      acceptanceHash: hash("b"),
      artifactHashes: [],
      verificationEventIds: [],
    };
    expect(project(state)).toMatchObject({
      reasonCode: "acceptance_rejected",
      nextAction: "escalate",
    });
    const replacement = `asn_${"f".repeat(24)}`;
    state.unboundAssignmentIds = [replacement];
    expect(project(state)).toMatchObject({
      reasonCode: "responsibility_installation_required",
      nextAction: "allocate_existing",
      assignmentIds: [replacement],
    });
  });
  it("preserves exact rework and stops new admission after revocation", () => {
    const state = snapshot();
    state.assignments[0]!.review = {
      verdict: "rework",
      reviewerAgentId: owner,
      acceptanceHash: hash("b"),
      artifactHashes: [],
      verificationEventIds: [],
    };
    expect(project(state).nextAction).toBe("request_rework");
    state.authorityStatus = "revoked";
    expect(project(state)).toMatchObject({ status: "waiting_decision", nextAction: null });
  });
});
