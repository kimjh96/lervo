import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type { DeliberationArtifact, DeliberationOutcome, DeliberationPolicy } from "@lervo/schemas";

export function deliberationSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function deliberationPolicyHash(policy: DeliberationPolicy): string {
  return deliberationSha256(canonicalJson(policy));
}

export function calculateDeliberationArtifactId(
  value: Omit<DeliberationArtifact, "deliberationArtifactId"> | DeliberationArtifact,
): string {
  const { deliberationArtifactId: _id, ...content } = value as DeliberationArtifact;
  return `dla_${deliberationSha256(canonicalJson(content)).slice(7, 23)}`;
}

export function calculateDeliberationOutcomeId(
  value: Omit<DeliberationOutcome, "outcomeId"> | DeliberationOutcome,
): string {
  const { outcomeId: _id, ...content } = value as DeliberationOutcome;
  return `dlo_${deliberationSha256(canonicalJson(content)).slice(7, 23)}`;
}
