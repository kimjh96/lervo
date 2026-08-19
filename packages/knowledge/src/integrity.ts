import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { KnowledgeCandidate } from "@lervo/schemas";

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
