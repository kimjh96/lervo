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
      "지식 승격 정책이 schema를 통과하지 못했습니다.",
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
      "검토 승인 CAS 원본을 읽지 못했습니다.",
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
      "검토 승인 원본의 schema, hash 또는 ID가 다릅니다.",
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
      "현재 event 원본에서 같은 검토 승인을 확인할 수 없습니다.",
    );
  }
  if (approval.decision !== "approved") {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "approval_not_approved",
      "거절된 검토 원본으로 지식을 verified로 승격할 수 없습니다.",
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
      "승인 원본이 현재 후보 또는 승격 정책과 다릅니다.",
    );
  }
  if (
    input.policy.requireResolvedConflicts &&
    !sameStrings(approval.resolvedConflictCandidateIds, input.candidate.conflictCandidateIds)
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "conflicts_unresolved",
      "현재 정책상 해소되지 않은 충돌 후보가 있습니다.",
    );
  }
  if (
    input.currentSnapshot.revision !== input.candidate.verifiedRevision ||
    input.currentSnapshot.revision !== approval.repositoryRevision
  ) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "repository_revision_mismatch",
      "현재 저장소가 후보와 승인 원본이 검토한 revision과 다릅니다.",
    );
  }
  if (input.candidate.paths.some((path) => input.currentSnapshot.files[path] === undefined)) {
    throw new KnowledgeError(
      "promotion_not_eligible",
      "linked_path_missing",
      "승격할 후보의 영향 path가 현재 저장소 snapshot에 없습니다.",
    );
  }
  return { candidateEvent, reviewEvent: storedReviewEvent };
}
