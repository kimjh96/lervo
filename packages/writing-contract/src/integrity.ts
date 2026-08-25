import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { WritingContract, WritingEvaluation, WritingPublicationPermit } from "@lervo/schemas";

export function writingSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function writingPolicyHash(contract: WritingContract): string {
  return writingSha256(canonicalJson(contract));
}

export function calculateWritingEvaluationId(
  value: Omit<WritingEvaluation, "evaluationId"> | WritingEvaluation,
): string {
  const { evaluationId: _evaluationId, ...content } = value as WritingEvaluation;
  return `wre_${writingSha256(canonicalJson(content)).slice(7, 23)}`;
}

export function calculateWritingPublicationPermitId(
  value: Omit<WritingPublicationPermit, "permitId"> | WritingPublicationPermit,
): string {
  const { permitId: _permitId, ...content } = value as WritingPublicationPermit;
  return `wpp_${writingSha256(canonicalJson(content)).slice(7, 23)}`;
}

export function writingEvaluationBytes(evaluation: WritingEvaluation): Uint8Array {
  return Buffer.from(canonicalJson(evaluation), "utf8");
}
