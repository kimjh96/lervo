import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type {
  KnowledgeCandidate,
  KnowledgePromotionPolicy,
  KnowledgeReviewApproval,
  KnowledgeStalenessResult,
  VerifiedKnowledge,
} from "@lervo/schemas";

export function knowledgeSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function knowledgeCandidateBytes(candidate: KnowledgeCandidate): Uint8Array {
  return Buffer.from(canonicalJson(candidate), "utf8");
}

export function calculateKnowledgeCandidateId(
  value: Omit<KnowledgeCandidate, "candidateId"> | KnowledgeCandidate,
): string {
  const { candidateId: _candidateId, ...content } = value as KnowledgeCandidate;
  return `knc_${knowledgeSha256(canonicalJson(content)).slice(7, 23)}`;
}

function contentWithoutId<T extends object>(value: T, idKey: keyof T): Record<string, unknown> {
  const content = { ...value } as Record<string, unknown>;
  delete content[idKey as string];
  return content;
}

export function knowledgeReviewApprovalBytes(value: KnowledgeReviewApproval): Uint8Array {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function calculateKnowledgeReviewApprovalId(
  value: Omit<KnowledgeReviewApproval, "approvalId"> | KnowledgeReviewApproval,
): string {
  return `knr_${knowledgeSha256(
    canonicalJson(contentWithoutId(value, "approvalId" as keyof typeof value)),
  ).slice(7, 23)}`;
}

export function calculateKnowledgePromotionPolicyVersion(
  value: Omit<KnowledgePromotionPolicy, "policyVersion"> | KnowledgePromotionPolicy,
): string {
  return knowledgeSha256(
    canonicalJson(contentWithoutId(value, "policyVersion" as keyof typeof value)),
  );
}

export function verifiedKnowledgeBytes(value: VerifiedKnowledge): Uint8Array {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function calculateVerifiedKnowledgeId(
  value: Omit<VerifiedKnowledge, "knowledgeId"> | VerifiedKnowledge,
): string {
  return `knw_${knowledgeSha256(
    canonicalJson(contentWithoutId(value, "knowledgeId" as keyof typeof value)),
  ).slice(7, 23)}`;
}

export function knowledgeStalenessResultBytes(value: KnowledgeStalenessResult): Uint8Array {
  return Buffer.from(canonicalJson(value), "utf8");
}

export function calculateKnowledgeStalenessResultId(
  value: Omit<KnowledgeStalenessResult, "resultId"> | KnowledgeStalenessResult,
): string {
  return `kst_${knowledgeSha256(
    canonicalJson(contentWithoutId(value, "resultId" as keyof typeof value)),
  ).slice(7, 23)}`;
}
