import {
  calculateKnowledgeReviewApprovalId,
  calculateKnowledgePromotionPolicyVersion,
  knowledgeReviewApprovalBytes,
  knowledgeSha256,
} from "@lervo/knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeCandidateReviewedEventPayload,
  type KnowledgeReviewApproval,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DoctorIssue } from "./types.js";

export async function inspectKnowledgeReview(input: {
  event: EventEnvelope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const add = (code: DoctorIssue["code"], message: string) =>
    issues.push({ code, eventId: input.event.eventId, message });
  if (!validateSchema("knowledgeCandidateReviewedEventPayload", input.event.payload).valid) {
    add("review_event_mismatch", "지식 검토 event가 현재 payload 계약과 다릅니다.");
    return issues;
  }
  const payload = input.event.payload as unknown as KnowledgeCandidateReviewedEventPayload;
  try {
    const uri = `lervo-cas://sha256/${payload.approvalContentHash.slice(7)}`;
    const bytes = await input.artifacts.get(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!validateSchema("knowledgeReviewApproval", parsed).valid) throw new Error("schema");
    const approval = parsed as KnowledgeReviewApproval;
    if (
      knowledgeSha256(bytes) !== payload.approvalContentHash ||
      payload.approvalArtifactId !== `art_${payload.approvalContentHash.slice(7)}` ||
      calculateKnowledgeReviewApprovalId(approval) !== approval.approvalId ||
      !Buffer.from(knowledgeReviewApprovalBytes(approval)).equals(Buffer.from(bytes)) ||
      approval.approvalId !== payload.approvalId ||
      approval.candidateId !== payload.candidateId ||
      approval.candidateContentHash !== payload.candidateContentHash ||
      approval.decision !== payload.decision ||
      approval.policy.policyId !== payload.policyId ||
      approval.policy.policyVersion !== payload.policyVersion ||
      calculateKnowledgePromotionPolicyVersion(approval.policy) !==
        approval.policy.policyVersion ||
      !approval.policy.allowedReviewerIds.includes(approval.reviewer.reviewerId) ||
      approval.repositoryRevision !== payload.repositoryRevision ||
      JSON.stringify(approval.resolvedConflictCandidateIds) !==
        JSON.stringify(payload.resolvedConflictCandidateIds)
    ) throw new Error("coordinate");
  } catch {
    add("review_artifact_invalid", "지식 검토 승인 CAS 원본을 확인할 수 없습니다.");
    return issues;
  }
  if (!input.events.some((event) =>
    event.type === "knowledge.candidate.created" &&
    event.payload.candidateId === payload.candidateId &&
    event.payload.candidateContentHash === payload.candidateContentHash)) {
    add("review_candidate_missing", "지식 검토가 가리키는 candidate event가 없습니다.");
  }
  return issues;
}
