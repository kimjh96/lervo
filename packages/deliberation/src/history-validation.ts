import type { DeliberationArtifact, DeliberationPolicy } from "@lervo/schemas";

import { validateDeliberationArtifactAgainstValidatedPolicy } from "./artifact-validation.js";
import { applyArtifactTransition } from "./artifact-transitions.js";
import { validateHistoryCoordinates } from "./history-coordinates.js";
import {
  createDeliberationHistoryState,
  type DeliberationHistoryAnalysis,
} from "./history-state.js";
import {
  DeliberationError,
  type DeliberationVerificationEvidence,
} from "./types.js";
import { verificationEvidenceById } from "./verification-evidence.js";

export function analyzeDeliberationHistory(input: {
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
}): DeliberationHistoryAnalysis {
  const verificationById = verificationEvidenceById(input.verificationEvidence);
  const state = createDeliberationHistoryState();

  for (const [artifactIndex, artifact] of input.artifacts.entries()) {
    validateDeliberationArtifactAgainstValidatedPolicy(artifact, input.policy);
    validateHistoryCoordinates(state, artifact);
    applyArtifactTransition({ state, artifact, artifactIndex, verificationById });
    state.artifactsById.set(artifact.deliberationArtifactId, artifact);
  }

  if (
    state.decision !== null &&
    input.artifacts.at(-1)?.deliberationArtifactId !== state.decision.deliberationArtifactId
  ) {
    throw new DeliberationError(
      "history_contract_invalid",
      "decision_not_terminal",
      "Decision 뒤에는 다른 숙의 artifact를 기록할 수 없습니다.",
    );
  }
  const recordedVerificationIds = new Set(input.artifacts
    .filter((artifact): artifact is Extract<DeliberationArtifact, { kind: "verification" }> =>
      artifact.kind === "verification")
    .map((artifact) => artifact.details.verificationId));
  if (
    verificationById.size !== recordedVerificationIds.size ||
    [...verificationById.keys()].some((verificationId) => !recordedVerificationIds.has(verificationId))
  ) {
    throw new DeliberationError(
      "verification_evidence_invalid",
      "unexpected_verification_evidence",
      "숙의 이력에 기록되지 않은 verification 근거가 포함되었습니다.",
    );
  }
  const openBlockingObjectionIds = [...state.objections.entries()]
    .filter(([, value]) => value.blocking && !value.resolved)
    .map(([id]) => id);
  return {
    deliberationId: state.deliberationId ?? "",
    lastRound: state.previousRound,
    artifactIds: input.artifacts.map((artifact) => artifact.deliberationArtifactId),
    lastArtifactId: input.artifacts.at(-1)?.deliberationArtifactId ?? null,
    openBlockingObjectionIds,
    passedVerificationArtifactIds: state.passedVerificationArtifactIds,
    passedVerificationSuiteIds: state.passedVerificationSuiteIds,
    passedClaimIdsBySuite: state.passedClaimIdsBySuite,
    independentReviewApproved:
      state.lastApprovedReviewIndex > state.lastProposalOrRevisionIndex,
    decision: state.decision,
  };
}

export function validateDeliberationHistory(input: {
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
}): void {
  analyzeDeliberationHistory(input);
}
