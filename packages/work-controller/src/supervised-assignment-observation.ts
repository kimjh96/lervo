import type { SupervisedAssignmentObservationV1 } from "@lervo/application-contract";
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

/** The review binds the acceptance owner, acceptance contract, and exact artifacts. */
export function currentReview(assignment: SupervisedAssignmentObservationV1): boolean {
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

/** Structural bounds of one supervised assignment observation. */
export function validAssignment(item: SupervisedAssignmentObservationV1): boolean {
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
