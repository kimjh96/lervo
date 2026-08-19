import {
  calculateKnowledgeReviewApprovalId,
  calculateVerifiedKnowledgeId,
  knowledgeReviewApprovalBytes,
  knowledgeSha256,
  verifiedKnowledgeBytes,
} from "@lervo/knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeReviewApproval,
  type KnowledgeVerifiedEventPayload,
  type VerifiedKnowledge,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DoctorIssue } from "./types.js";

function issue(
  issues: DoctorIssue[], code: DoctorIssue["code"], eventId: string, message: string,
): void {
  issues.push({ code, eventId, message });
}

export async function inspectVerifiedKnowledge(input: {
  event: EventEnvelope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  if (!validateSchema("knowledgeVerifiedEventPayload", input.event.payload).valid) {
    issue(issues, "verified_event_mismatch", input.event.eventId,
      "Verified 지식 event가 현재 payload 계약과 다릅니다.");
    return issues;
  }
  const payload = input.event.payload as unknown as KnowledgeVerifiedEventPayload;
  let knowledge: VerifiedKnowledge;
  try {
    const uri = `lervo-cas://sha256/${payload.knowledgeContentHash.slice(7)}`;
    const bytes = await input.artifacts.get(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!validateSchema("verifiedKnowledge", parsed).valid) throw new Error("schema invalid");
    knowledge = parsed as VerifiedKnowledge;
    if (
      knowledgeSha256(bytes) !== payload.knowledgeContentHash ||
      payload.knowledgeArtifactId !== `art_${payload.knowledgeContentHash.slice(7)}` ||
      calculateVerifiedKnowledgeId(knowledge) !== knowledge.knowledgeId ||
      !Buffer.from(verifiedKnowledgeBytes(knowledge)).equals(Buffer.from(bytes))
    ) throw new Error("coordinate mismatch");
  } catch {
    issue(issues, "verified_artifact_invalid", input.event.eventId,
      "Verified 지식 CAS 원본의 schema, hash 또는 ID를 확인할 수 없습니다.");
    return issues;
  }
  if (
    knowledge.knowledgeId !== payload.knowledgeId ||
    knowledge.candidate.candidateId !== payload.candidateId ||
    knowledge.candidate.artifact.contentHash !== payload.candidateContentHash ||
    knowledge.approval.approvalId !== payload.approvalId ||
    knowledge.approval.artifact.contentHash !== payload.approvalContentHash ||
    knowledge.claim.claimDigest !== payload.claimDigest ||
    knowledge.verifiedRevision !== payload.verifiedRevision ||
    JSON.stringify(knowledge.paths.map((item) => item.path)) !== JSON.stringify(payload.paths)
  ) {
    issue(issues, "verified_event_mismatch", input.event.eventId,
      "Verified 지식 원본과 event 좌표가 다릅니다.");
  }
  const candidateEvent = input.events.find((event) =>
    event.type === "knowledge.candidate.created" &&
    event.payload.candidateId === knowledge.candidate.candidateId &&
    event.payload.candidateContentHash === knowledge.candidate.artifact.contentHash);
  if (candidateEvent === undefined || !knowledge.evidenceEventIds.includes(candidateEvent.eventId)) {
    issue(issues, "verified_candidate_missing", input.event.eventId,
      "Verified 지식의 candidate 생성 event를 확인할 수 없습니다.");
  }
  const reviewEvent = input.events.find((event) =>
    event.type === "knowledge.candidate.reviewed" &&
    event.payload.approvalId === knowledge.approval.approvalId &&
    event.payload.approvalContentHash === knowledge.approval.artifact.contentHash);
  if (
    reviewEvent === undefined || reviewEvent.payload.decision !== "approved" ||
    !knowledge.evidenceEventIds.includes(reviewEvent.eventId)
  ) {
    issue(issues, "verified_review_missing", input.event.eventId,
      "Verified 지식의 승인된 review event를 확인할 수 없습니다.");
  }
  try {
    const bytes = await input.artifacts.get(knowledge.approval.artifact.uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!validateSchema("knowledgeReviewApproval", parsed).valid) throw new Error("schema");
    const approval = parsed as KnowledgeReviewApproval;
    if (
      approval.decision !== "approved" ||
      approval.approvalId !== knowledge.approval.approvalId ||
      approval.candidateId !== knowledge.candidate.candidateId ||
      approval.repositoryRevision !== knowledge.verifiedRevision ||
      knowledgeSha256(bytes) !== knowledge.approval.artifact.contentHash ||
      calculateKnowledgeReviewApprovalId(approval) !== approval.approvalId ||
      !Buffer.from(knowledgeReviewApprovalBytes(approval)).equals(Buffer.from(bytes))
    ) throw new Error("approval mismatch");
  } catch {
    issue(issues, "verified_review_missing", input.event.eventId,
      "Verified 지식의 사람 승인 CAS 원본을 확인할 수 없습니다.");
  }
  return issues;
}
