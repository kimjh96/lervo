import { validateSchema, type KnowledgeReviewApproval } from "@lervo/schemas";

import { storeKnowledgeArtifact } from "./artifact-storage.js";
import { verifyKnowledgeCandidateOriginal } from "./candidate-original.js";
import {
  calculateKnowledgeReviewApprovalId,
  calculateKnowledgePromotionPolicyVersion,
  knowledgeReviewApprovalBytes,
} from "./integrity.js";
import {
  KnowledgeError,
  type ReviewKnowledgeCandidateInput,
  type ReviewedKnowledgeCandidate,
} from "./types.js";

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function reviewKnowledgeCandidate(
  input: ReviewKnowledgeCandidateInput,
): Promise<ReviewedKnowledgeCandidate> {
  if (
    !validateSchema("knowledgePromotionPolicy", input.policy).valid ||
    calculateKnowledgePromotionPolicyVersion(input.policy) !== input.policy.policyVersion
  ) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "policy_schema_invalid",
      "The knowledge promotion policy does not satisfy the schema.",
    );
  }
  await verifyKnowledgeCandidateOriginal(input);
  if (!input.policy.allowedReviewerIds.includes(input.reviewerId)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "reviewer_not_allowed",
      "The human reviewer is not allowed by the current policy.",
    );
  }
  if (input.repositoryRevision !== input.candidate.verifiedRevision) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "repository_revision_mismatch",
      "The review revision differs from the repository revision that verified the candidate.",
    );
  }
  const resolvedConflictCandidateIds = sortedUnique(input.resolvedConflictCandidateIds);
  if (resolvedConflictCandidateIds.some((candidateId) =>
    !input.candidate.conflictCandidateIds.includes(candidateId))) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "conflicts_unresolved",
      "A conflict not recorded in the candidate cannot be marked as resolved.",
    );
  }
  if (
    input.decision === "approved" && input.policy.requireResolvedConflicts &&
    JSON.stringify(resolvedConflictCandidateIds) !==
      JSON.stringify([...input.candidate.conflictCandidateIds].sort())
  ) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "conflicts_unresolved",
      "Policy requires every conflict candidate to be reviewed and resolved before approval.",
    );
  }
  const content = {
    schemaVersion: 1 as const,
    projectId: input.candidate.projectId,
    candidateId: input.candidate.candidateId,
    candidateContentHash: input.candidateArtifact.contentHash,
    decision: input.decision,
    reviewer: { kind: "human" as const, reviewerId: input.reviewerId },
    policy: structuredClone(input.policy),
    repositoryRevision: input.repositoryRevision,
    resolvedConflictCandidateIds,
    reviewedAt: input.reviewedAt,
  };
  const approval = {
    ...content,
    approvalId: calculateKnowledgeReviewApprovalId(
      content as Omit<KnowledgeReviewApproval, "approvalId">,
    ),
  } as KnowledgeReviewApproval;
  if (!validateSchema("knowledgeReviewApproval", approval).valid) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "approval_schema_invalid",
      "The knowledge review approval source does not satisfy the schema.",
    );
  }
  if (Date.parse(approval.reviewedAt) < Date.parse(input.candidate.createdAt)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "approval_schema_invalid",
      "A review approval dated before candidate creation cannot be recorded.",
    );
  }
  if (input.events.list().some((event) =>
    event.type === "knowledge.candidate.reviewed" &&
    event.payload.approvalId === approval.approvalId)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "approval_already_recorded",
      "The same review approval source is already recorded in an event.",
    );
  }
  const approvalArtifact = await storeKnowledgeArtifact({
    artifactStore: input.artifactStore,
    bytes: knowledgeReviewApprovalBytes(approval),
    mismatchReason: "approval_artifact_mismatch",
    label: "knowledge review approval",
  });
  try {
    const recordedEvent = input.events.append({
      eventId: input.createEventId(),
      projectId: input.candidate.projectId,
      runId: input.runId,
      sessionId: input.sessionId,
      type: "knowledge.candidate.reviewed",
      occurredAt: approval.reviewedAt,
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion: input.policy.policyVersion,
      payload: {
        candidateId: approval.candidateId,
        candidateContentHash: approval.candidateContentHash,
        approvalId: approval.approvalId,
        approvalArtifactId: approvalArtifact.artifactId,
        approvalContentHash: approvalArtifact.contentHash,
        decision: approval.decision,
        policyId: approval.policy.policyId,
        policyVersion: approval.policy.policyVersion,
        repositoryRevision: approval.repositoryRevision,
        resolvedConflictCandidateIds: approval.resolvedConflictCandidateIds,
      },
    }).event;
    return { approval, approvalArtifact, recordedEvent };
  } catch (error) {
    throw new KnowledgeError(
      "event_recording_failed",
      "event_store_failed",
      "Could not record the knowledge review event.",
      { cause: error },
    );
  }
}
