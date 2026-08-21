import { createHash } from "node:crypto";

import {
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
} from "@lervo/deliberation";
import type {
  DeliberationArtifact,
  DeliberationOutcome,
  DeliberationPolicy,
} from "@lervo/schemas";

function coordinate(prefix: "clm" | "obj", value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

export function initialClaimId(deliberationId: string): string {
  return coordinate("clm", deliberationId);
}

export function reviewDetails(input: {
  content: string;
  contentHash: string;
  claimId: string;
}): Extract<DeliberationArtifact, { kind: "objection" }>["details"] {
  const firstLine = input.content.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim();
  if (firstLine === "판정: 승인") {
    return { reviewStatus: "approved", objections: [] };
  }
  if (firstLine !== "판정: 수정 필요") {
    throw new Error("검토 결과의 첫 문장은 '판정: 승인' 또는 '판정: 수정 필요'여야 합니다.");
  }
  return {
    reviewStatus: "changes_requested",
    objections: [{
      objectionId: coordinate("obj", input.contentHash),
      objectionDigest: input.contentHash,
      targetClaimIds: [input.claimId],
      blocking: true,
      status: "open",
    }],
  };
}

function baseOutcome(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  history: readonly DeliberationArtifact[];
  completedAt: string;
}) {
  return {
    schemaVersion: 1 as const,
    outcomeId: "dlo_0000000000000000",
    deliberationId: input.deliberationId,
    projectId: input.policy.projectId,
    policyId: input.policy.policyId,
    policyHash: deliberationPolicyHash(input.policy),
    lastRound: input.history.at(-1)?.round ?? 1,
    artifactIds: input.history.map((artifact) => artifact.deliberationArtifactId),
    lastConfirmedArtifactId: input.history.at(-1)?.deliberationArtifactId ?? null,
    passedVerificationArtifactIds: input.history
      .filter((artifact) =>
        artifact.kind === "verification" && artifact.details.status === "passed")
      .map((artifact) => artifact.deliberationArtifactId),
    completedAt: input.completedAt,
  };
}

export function createNoConsensusOutcome(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  history: readonly DeliberationArtifact[];
  completedAt: string;
  reason: "blocking_objections_unresolved" | "required_verification_not_passed";
  unresolvedBlockingObjectionIds: readonly string[];
}): DeliberationOutcome {
  const withoutId = {
    ...baseOutcome(input),
    status: "no_consensus" as const,
    decisionArtifactId: null,
    unresolvedBlockingObjectionIds: [...input.unresolvedBlockingObjectionIds],
    noConsensusReason: input.reason,
    failure: null,
  };
  return {
    ...withoutId,
    outcomeId: calculateDeliberationOutcomeId(withoutId as DeliberationOutcome),
  } as DeliberationOutcome;
}

export function createConvergedOutcome(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  history: readonly DeliberationArtifact[];
  completedAt: string;
  decisionArtifactId: string;
}): DeliberationOutcome {
  const withoutId = {
    ...baseOutcome(input),
    status: "converged" as const,
    decisionArtifactId: input.decisionArtifactId,
    unresolvedBlockingObjectionIds: [],
    noConsensusReason: null,
    failure: null,
  };
  return {
    ...withoutId,
    outcomeId: calculateDeliberationOutcomeId(withoutId as DeliberationOutcome),
  } as DeliberationOutcome;
}

export function createFailedOutcome(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  history: readonly DeliberationArtifact[];
  completedAt: string;
  unresolvedBlockingObjectionIds: readonly string[];
  code: string;
}): DeliberationOutcome {
  const normalizedCode = /^[a-z][a-z0-9_]{0,63}$/u.test(input.code)
    ? input.code
    : "deliberation_failed";
  const withoutId = {
    ...baseOutcome(input),
    status: "failed" as const,
    decisionArtifactId: null,
    unresolvedBlockingObjectionIds: [...input.unresolvedBlockingObjectionIds],
    noConsensusReason: null,
    failure: { phase: "contract" as const, code: normalizedCode, retryable: false },
  };
  return {
    ...withoutId,
    outcomeId: calculateDeliberationOutcomeId(withoutId as DeliberationOutcome),
  } as DeliberationOutcome;
}
