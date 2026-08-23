import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeReviewApproval,
} from "@lervo/schemas";

import { verifyKnowledgeCandidateOriginal } from "./candidate-original.js";
import {
  calculateKnowledgeReviewApprovalId,
  calculateKnowledgePromotionPolicyVersion,
  knowledgeReviewApprovalBytes,
  knowledgeSha256,
} from "./integrity.js";
import {
  KnowledgeError,
  type PromoteKnowledgeCandidateInput,
} from "./types.js";

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export async function validatePromotionInput(
  input: PromoteKnowledgeCandidateInput,
): Promise<{ candidateEvent: EventEnvelope; reviewEvent: EventEnvelope }> {
  if (
    !validateSchema("knowledgePromotionPolicy", input.policy).valid ||
    calculateKnowledgePromotionPolicyVersion(input.policy) !== input.policy.policyVersion
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "policy_schema_invalid",
      "The knowledge promotion policy does not satisfy the schema.",
    );
  }
  const candidateEvent = await verifyKnowledgeCandidateOriginal(input);
  const { approval, approvalArtifact, recordedEvent } = input.review;
  let approvalBytes: Uint8Array;
  try {
    approvalBytes = await input.artifactStore.get(approvalArtifact.uri);
  } catch (error) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "approval_artifact_mismatch",
      "Could not read the review approval CAS source.",
      { cause: error },
    );
  }
  if (
    !validateSchema("knowledgeReviewApproval", approval).valid ||
    calculateKnowledgeReviewApprovalId(approval) !== approval.approvalId ||
    approvalArtifact.artifactId !== `art_${approvalArtifact.contentHash.slice(7)}` ||
    approvalArtifact.uri !== `lervo-cas://sha256/${approvalArtifact.contentHash.slice(7)}` ||
    approvalArtifact.contentHash !== knowledgeSha256(approvalBytes) ||
    approvalArtifact.byteCount !== approvalBytes.byteLength ||
    !Buffer.from(knowledgeReviewApprovalBytes(approval)).equals(Buffer.from(approvalBytes))
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "approval_artifact_mismatch",
      "The review approval source schema, hash, or ID differs.",
    );
  }
  const storedReviewEvent = input.events.get(recordedEvent.eventId);
  if (
    storedReviewEvent === null || storedReviewEvent.eventHash !== recordedEvent.eventHash ||
    storedReviewEvent.type !== "knowledge.candidate.reviewed" ||
    storedReviewEvent.payload.approvalId !== approval.approvalId ||
    storedReviewEvent.payload.approvalContentHash !== approvalArtifact.contentHash ||
    storedReviewEvent.payload.candidateId !== input.candidate.candidateId ||
    storedReviewEvent.payload.candidateContentHash !== input.candidateArtifact.contentHash
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "review_event_missing",
      "The same review approval cannot be verified in the current event source.",
    );
  }
  if (approval.decision !== "approved") {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "approval_not_approved",
      "Knowledge cannot be promoted to verified from a rejected review source.",
    );
  }
  if (
    approval.candidateId !== input.candidate.candidateId ||
    approval.candidateContentHash !== input.candidateArtifact.contentHash ||
    approval.projectId !== input.candidate.projectId ||
    approval.policy.policyId !== input.policy.policyId ||
    approval.policy.policyVersion !== input.policy.policyVersion ||
    calculateKnowledgePromotionPolicyVersion(approval.policy) !==
      approval.policy.policyVersion ||
    JSON.stringify(approval.policy) !== JSON.stringify(input.policy) ||
    !input.policy.allowedReviewerIds.includes(approval.reviewer.reviewerId)
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "reviewer_not_allowed",
      "The approval source differs from the current candidate or promotion policy.",
    );
  }
  if (
    input.policy.requireResolvedConflicts &&
    !sameStrings(approval.resolvedConflictCandidateIds, input.candidate.conflictCandidateIds)
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "conflicts_unresolved",
      "The current policy has unresolved conflict candidates.",
    );
  }
  if (
    input.currentSnapshot.revision !== input.candidate.verifiedRevision ||
    input.currentSnapshot.revision !== approval.repositoryRevision
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "repository_revision_mismatch",
      "The current repository differs from the revision reviewed by the candidate and approval source.",
    );
  }
  if (input.candidate.paths.some((path) => input.currentSnapshot.files[path] === undefined)) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "linked_path_missing",
      "An impact path of the candidate to promote is missing from the current repository snapshot.",
    );
  }
  return { candidateEvent, reviewEvent: storedReviewEvent };
}
