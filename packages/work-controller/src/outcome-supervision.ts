import type {
  OutcomeSupervisionReportV1,
  OutcomeSupervisionSnapshotV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import {
  operatingHashPattern,
  operatingInteger,
  operatingTime,
} from "./operating-contract-validation.js";

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function currentReview(assignment: SupervisedAssignmentObservationV1): boolean {
  const review = assignment.review;
  return (
    review !== null &&
    review.reviewerAgentId === assignment.acceptanceOwnerAgentId &&
    review.acceptanceHash === assignment.acceptanceHash &&
    sameSet(review.artifactHashes, assignment.artifactHashes)
  );
}

export function isSupervisedAssignmentAccepted(
  assignment: SupervisedAssignmentObservationV1,
): boolean {
  const review = assignment.review;
  if (
    assignment.status !== "completed" ||
    assignment.effectDisposition !== "reconciled" ||
    assignment.terminalEventId === null ||
    assignment.artifactHashes.length === 0 ||
    review === null ||
    review.verdict !== "accepted" ||
    review.reviewerAgentId !== assignment.acceptanceOwnerAgentId ||
    review.acceptanceHash !== assignment.acceptanceHash ||
    !sameSet(review.artifactHashes, assignment.artifactHashes)
  )
    return false;
  const passed = assignment.verification.filter(
    (item) =>
      item.status === "passed" &&
      sameSet(item.artifactHashes, assignment.artifactHashes) &&
      review.verificationEventIds.includes(item.eventId),
  );
  return (
    assignment.requiredVerificationSuiteIds.length > 0 &&
    assignment.requiredVerificationSuiteIds.every((suite) =>
      passed.some((item) => item.suiteId === suite),
    ) &&
    review.verificationEventIds.every((eventId) => passed.some((item) => item.eventId === eventId))
  );
}

function validAssignment(item: SupervisedAssignmentObservationV1): boolean {
  return (
    /^asn_[a-f0-9]{24}$/u.test(item.assignmentId) &&
    operatingInteger(item.revision, 1) &&
    /^agt_[a-f0-9]{24}$/u.test(item.executorAgentId) &&
    /^agt_[a-f0-9]{24}$/u.test(item.acceptanceOwnerAgentId) &&
    operatingHashPattern.test(item.responsibilityArtifactHash) &&
    operatingHashPattern.test(item.acceptanceHash) &&
    ["queued", "leased", "blocked", "completed", "failed", "cancelled"].includes(item.status) &&
    ["not_started", "known_safe_failure", "uncertain", "reconciled"].includes(
      item.effectDisposition,
    ) &&
    [item.startDeadline, item.progressDeadline, item.completionDeadline].every(operatingTime) &&
    Date.parse(item.startDeadline) <= Date.parse(item.progressDeadline) &&
    Date.parse(item.progressDeadline) <= Date.parse(item.completionDeadline) &&
    [item.dispatchedAt, item.startedAt].every((time) => time === null || operatingTime(time)) &&
    (item.terminalEventId === null || /^evt_[a-f0-9]{32}$/u.test(item.terminalEventId)) &&
    operatingInteger(item.recoveryDecisionCount, 0, 256) &&
    Array.isArray(item.artifactHashes) &&
    item.artifactHashes.length <= 64 &&
    item.artifactHashes.every((hash) => operatingHashPattern.test(hash)) &&
    Array.isArray(item.requiredVerificationSuiteIds) &&
    item.requiredVerificationSuiteIds.length <= 32 &&
    Array.isArray(item.verification) &&
    item.verification.length <= 64 &&
    item.verification.every(
      (entry) =>
        typeof entry.suiteId === "string" &&
        entry.suiteId.length <= 128 &&
        /^evt_[a-f0-9]{32}$/u.test(entry.eventId) &&
        ["passed", "failed"].includes(entry.status) &&
        Array.isArray(entry.artifactHashes) &&
        entry.artifactHashes.length <= 64 &&
        entry.artifactHashes.every((hash) => operatingHashPattern.test(hash)),
    ) &&
    (item.review === null ||
      (["accepted", "rework", "blocked"].includes(item.review.verdict) &&
        /^agt_[a-f0-9]{24}$/u.test(item.review.reviewerAgentId) &&
        operatingHashPattern.test(item.review.acceptanceHash) &&
        Array.isArray(item.review.artifactHashes) &&
        item.review.artifactHashes.length <= 64 &&
        item.review.artifactHashes.every((hash) => operatingHashPattern.test(hash)) &&
        Array.isArray(item.review.verificationEventIds) &&
        item.review.verificationEventIds.length <= 64 &&
        item.review.verificationEventIds.every((id) => /^evt_[a-f0-9]{32}$/u.test(id))))
  );
}

export function projectOutcomeSupervision(input: {
  snapshot: OutcomeSupervisionSnapshotV1;
  now: string;
  maximumRecoveryDecisions: number;
}): OutcomeSupervisionReportV1 {
  const { snapshot, now } = input;
  const unbound = snapshot.unboundAssignmentIds ?? [];
  if (
    !operatingTime(now) ||
    !operatingInteger(input.maximumRecoveryDecisions, 0, 3) ||
    snapshot.schemaVersion !== 1 ||
    !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(snapshot.supervisionId) ||
    !/^prj_[a-f0-9]{16}$/u.test(snapshot.projectId) ||
    !/^wks_[a-f0-9]{24}$/u.test(snapshot.workstreamId) ||
    !/^agt_[a-f0-9]{24}$/u.test(snapshot.ownerAgentId) ||
    !operatingHashPattern.test(snapshot.sourceRevisionDigest) ||
    !operatingHashPattern.test(snapshot.mandateHash) ||
    !operatingInteger(snapshot.workstreamRevision, 1) ||
    !Array.isArray(snapshot.assignments) ||
    snapshot.assignments.length > 256 ||
    new Set(snapshot.assignments.map((item) => item.assignmentId)).size !==
      snapshot.assignments.length ||
    !snapshot.assignments.every(validAssignment) ||
    !Array.isArray(unbound) ||
    unbound.length + snapshot.assignments.length > 256 ||
    new Set(unbound).size !== unbound.length ||
    unbound.some(
      (id) =>
        !/^asn_[a-f0-9]{24}$/u.test(id) ||
        snapshot.assignments.some((item) => item.assignmentId === id),
    ) ||
    !operatingInteger(snapshot.escalationCount, 0, 32_768) ||
    !Array.isArray(snapshot.causationEventIds) ||
    snapshot.causationEventIds.length > 64 ||
    !snapshot.causationEventIds.every((id) => /^evt_[a-f0-9]{32}$/u.test(id)) ||
    !["valid", "unavailable", "conflict"].includes(snapshot.evidenceStatus) ||
    !["active", "revoked", "expired", "unobserved"].includes(snapshot.authorityStatus) ||
    !["active", "blocked", "completed", "cancelled"].includes(snapshot.workstreamStatus) ||
    !["not_attempted", "pending", "failed", "delivered"].includes(snapshot.delivery) ||
    (snapshot.deliveryRequired !== undefined && typeof snapshot.deliveryRequired !== "boolean") ||
    (snapshot.deliveryRecoverySafe !== undefined &&
      typeof snapshot.deliveryRecoverySafe !== "boolean") ||
    (snapshot.deliveryRecoverySafe === true &&
      (snapshot.delivery !== "failed" || snapshot.deliveryNextCheckAt !== null)) ||
    (snapshot.attentionPending !== undefined && typeof snapshot.attentionPending !== "boolean") ||
    (snapshot.handoffs !== undefined &&
      (snapshot.handoffs === null ||
        ![snapshot.handoffs.pendingIncoming, snapshot.handoffs.pendingOutgoing].every(
          (items) =>
            Array.isArray(items) &&
            items.length <= 32 &&
            new Set(items).size === items.length &&
            items.every((item) => operatingHashPattern.test(item)),
        ) ||
        (snapshot.handoffs.pendingOutgoing.length === 0
          ? snapshot.handoffs.nextCheckAt !== null
          : !operatingTime(snapshot.handoffs.nextCheckAt)))) ||
    (snapshot.deliveryNextCheckAt !== undefined &&
      snapshot.deliveryNextCheckAt !== null &&
      !operatingTime(snapshot.deliveryNextCheckAt)) ||
    typeof snapshot.pendingDecision !== "boolean"
  )
    throw new TypeError("The outcome supervision snapshot is invalid.");
  const report = (
    status: OutcomeSupervisionReportV1["status"],
    reasonCode: string,
    nextAction: OutcomeSupervisionReportV1["nextAction"],
    assignments = snapshot.assignments,
    nextCheckAt: string | null = null,
  ): OutcomeSupervisionReportV1 => ({
    schemaVersion: 1,
    kind: "work.supervision.report",
    supervisionId: snapshot.supervisionId,
    sourceRevisionDigest: snapshot.sourceRevisionDigest,
    ownerAgentId: snapshot.ownerAgentId,
    causationEventIds: [...snapshot.causationEventIds],
    status:
      nextAction === "escalate" && snapshot.escalationCount >= 8 ? "waiting_decision" : status,
    reasonCode:
      nextAction === "escalate" && snapshot.escalationCount >= 8
        ? "escalation_capacity_exceeded"
        : reasonCode,
    assignmentIds: assignments.map((item) => item.assignmentId),
    nextCheckAt,
    nextAction: nextAction === "escalate" && snapshot.escalationCount >= 8 ? null : nextAction,
  });
  if (snapshot.evidenceStatus !== "valid")
    return report("invalid", `evidence_${snapshot.evidenceStatus}`, null);
  const uncertain = snapshot.assignments.filter((item) => item.effectDisposition === "uncertain");
  if (
    uncertain.length > 0 &&
    snapshot.attentionPending === true &&
    snapshot.workstreamStatus !== "cancelled" &&
    snapshot.authorityStatus === "active"
  )
    return report("waiting_decision", "uncertain_effect_attention_pending", null, uncertain);
  if (uncertain.length > 0)
    return report("recovering", "effect_outcome_uncertain", "inspect_uncertain_effect", uncertain);
  if (snapshot.workstreamStatus === "cancelled") {
    const unfinished = snapshot.assignments.filter(
      (item) =>
        !["cancelled", "completed"].includes(item.status) ||
        !["not_started", "reconciled"].includes(item.effectDisposition),
    );
    if (unbound.length > 0)
      return {
        ...report("recovering", "cancellation_unreconciled", "reconcile_cancellation", unfinished),
        assignmentIds: [...unfinished.map((item) => item.assignmentId), ...unbound],
      };
    return unfinished.length > 0
      ? report("recovering", "cancellation_unreconciled", "reconcile_cancellation", unfinished)
      : report("cancelled", "canonical_cancellation_reconciled", null);
  }
  if (snapshot.authorityStatus !== "active")
    return report("waiting_decision", `authority_${snapshot.authorityStatus}`, null);
  if (snapshot.attentionPending === true)
    return report("waiting_decision", "owner_attention_pending", null);
  if ((snapshot.handoffs?.pendingIncoming.length ?? 0) > 0)
    return report("planning", "scoped_handoff_acceptance_required", "allocate_existing");
  const rejected = snapshot.assignments.filter(
    (item) => item.review?.verdict === "rework" && currentReview(item),
  );
  if (rejected.length > 0)
    return report(
      "reviewing",
      "acceptance_rejected",
      rejected.some((item) => item.recoveryDecisionCount >= input.maximumRecoveryDecisions)
        ? "escalate"
        : "request_rework",
      rejected,
    );
  const blockedReviews = snapshot.assignments.filter(
    (item) => item.review?.verdict === "blocked" && currentReview(item),
  );
  if (blockedReviews.length > 0)
    return report("waiting_decision", "acceptance_blocked", "escalate", blockedReviews);
  const failed = snapshot.assignments.filter((item) => item.status === "failed");
  if (failed.length > 0)
    return report(
      "recovering",
      "worker_failed",
      failed.every(
        (item) =>
          item.effectDisposition === "known_safe_failure" &&
          item.recoveryDecisionCount < input.maximumRecoveryDecisions,
      )
        ? "retry_attempt"
        : "escalate",
      failed,
    );
  const returned = snapshot.assignments.filter(
    (item) =>
      item.terminalEventId !== null &&
      !isSupervisedAssignmentAccepted(item) &&
      item.status !== "cancelled",
  );
  if (returned.length > 0)
    return report("reviewing", "artifact_acceptance_required", "review_artifacts", returned);
  if (
    unbound.length === 0 &&
    snapshot.assignments.length > 0 &&
    snapshot.assignments.every(isSupervisedAssignmentAccepted)
  ) {
    if ((snapshot.handoffs?.pendingOutgoing.length ?? 0) > 0)
      return report(
        "waiting_decision",
        "scoped_handoff_acceptance_pending",
        Date.parse(snapshot.handoffs!.nextCheckAt!) <= Date.parse(now) ? "escalate" : null,
        [],
        snapshot.handoffs!.nextCheckAt,
      );
    if (
      snapshot.workstreamStatus === "completed" &&
      snapshot.deliveryRequired === false &&
      snapshot.delivery === "not_attempted"
    )
      return report("completed", "accepted_local_result_available", null);
    if (snapshot.workstreamStatus === "completed" && snapshot.delivery === "pending")
      return report(
        "completed",
        "accepted_delivery_queued",
        null,
        [],
        snapshot.deliveryNextCheckAt ?? null,
      );
    if (
      snapshot.workstreamStatus === "completed" &&
      snapshot.delivery === "failed" &&
      snapshot.deliveryNextCheckAt === null
    )
      return snapshot.deliveryRecoverySafe === true
        ? report("reviewing", "result_delivery_recovery_safe", "publish_result")
        : report("waiting_decision", "result_delivery_recovery_exhausted", null);
    return snapshot.workstreamStatus === "completed"
      ? report(
          "completed",
          snapshot.delivery === "delivered"
            ? "accepted_and_delivered"
            : "accepted_delivery_pending",
          snapshot.delivery === "delivered" ? null : "publish_result",
        )
      : report("reviewing", "canonical_completion_required", "complete_workstream");
  }
  if (snapshot.workstreamStatus === "completed")
    return report("invalid", "canonical_completion_without_acceptance", null);
  const active = snapshot.assignments.filter(
    (item) =>
      item.status === "leased" || (item.dispatchedAt !== null && item.terminalEventId === null),
  );
  const due = active.filter(
    (item) =>
      Date.parse(item.startedAt === null ? item.startDeadline : item.progressDeadline) <=
        Date.parse(now) || Date.parse(item.completionDeadline) <= Date.parse(now),
  );
  if (due.length > 0)
    return report("recovering", "worker_deadline_elapsed", "inspect_uncertain_effect", due);
  if (snapshot.pendingDecision) return report("waiting_decision", "bounded_decision_pending", null);
  if (snapshot.assignments.length === 0 && (snapshot.handoffs?.pendingOutgoing.length ?? 0) > 0)
    return report(
      "waiting_decision",
      "scoped_handoff_acceptance_pending",
      Date.parse(snapshot.handoffs!.nextCheckAt!) <= Date.parse(now) ? "escalate" : null,
      [],
      snapshot.handoffs!.nextCheckAt,
    );
  const queued = snapshot.assignments.filter(
    (item) => ["queued", "leased"].includes(item.status) && item.dispatchedAt === null,
  );
  if (queued.length > 0) return report("planning", "ready_for_dispatch_review", "dispatch", queued);
  if (unbound.length > 0)
    return {
      ...report("planning", "responsibility_installation_required", "allocate_existing"),
      assignmentIds: [...unbound],
    };
  if (active.length > 0) {
    const deadlines = active
      .flatMap((item) => [
        item.startedAt === null ? item.startDeadline : item.progressDeadline,
        item.completionDeadline,
      ])
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    return report(
      active.some((item) => item.startedAt !== null) ? "executing" : "awaiting_start",
      "awaiting_worker_evidence",
      null,
      active,
      deadlines[0]!,
    );
  }
  if (
    snapshot.assignments.some(
      (item) =>
        item.status === "blocked" || (item.review?.verdict === "blocked" && currentReview(item)),
    )
  )
    return report("waiting_decision", "assignment_blocked", "escalate");
  return report("planning", "workforce_plan_required", "allocate_existing");
}
