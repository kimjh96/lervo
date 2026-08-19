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
      "지식 승격 정책이 schema를 통과하지 못했습니다.",
    );
  }
  await verifyKnowledgeCandidateOriginal(input);
  if (!input.policy.allowedReviewerIds.includes(input.reviewerId)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "reviewer_not_allowed",
      "현재 정책이 허용한 사람 reviewer가 아닙니다.",
    );
  }
  if (input.repositoryRevision !== input.candidate.verifiedRevision) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "repository_revision_mismatch",
      "검토 revision이 후보를 검증한 repository revision과 다릅니다.",
    );
  }
  const resolvedConflictCandidateIds = sortedUnique(input.resolvedConflictCandidateIds);
  if (resolvedConflictCandidateIds.some((candidateId) =>
    !input.candidate.conflictCandidateIds.includes(candidateId))) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "conflicts_unresolved",
      "후보에 기록되지 않은 충돌을 해소했다고 표시할 수 없습니다.",
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
      "정책상 모든 충돌 후보를 검토하고 해소해야 승인할 수 있습니다.",
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
      "지식 검토 승인 원본이 schema를 통과하지 못했습니다.",
    );
  }
  if (Date.parse(approval.reviewedAt) < Date.parse(input.candidate.createdAt)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "approval_schema_invalid",
      "후보가 생성되기 전 시각의 검토 승인을 기록할 수 없습니다.",
    );
  }
  if (input.events.list().some((event) =>
    event.type === "knowledge.candidate.reviewed" &&
    event.payload.approvalId === approval.approvalId)) {
    throw new KnowledgeError(
      "review_contract_invalid",
      "approval_already_recorded",
      "같은 검토 승인 원본이 이미 event에 기록되어 있습니다.",
    );
  }
  const approvalArtifact = await storeKnowledgeArtifact({
    artifactStore: input.artifactStore,
    bytes: knowledgeReviewApprovalBytes(approval),
    mismatchReason: "approval_artifact_mismatch",
    label: "지식 검토 승인",
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
      "지식 검토 event를 기록하지 못했습니다.",
      { cause: error },
    );
  }
}
