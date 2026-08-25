import type { DeliberationArtifact } from "@lervo/schemas";

import type { DeliberationHistoryState } from "./history-state.js";
import {
  DeliberationError,
  type DeliberationErrorReason,
  type DeliberationVerificationEvidence,
} from "./types.js";

function historyInvalid(reason: DeliberationErrorReason, message: string): never {
  throw new DeliberationError("history_contract_invalid", reason, message);
}

function exactSet(actual: readonly string[], expected: ReadonlySet<string>): boolean {
  return actual.length === expected.size && actual.every((value) => expected.has(value));
}

function hasUniqueClaimIds(claims: readonly { claimId: string }[]): boolean {
  return new Set(claims.map((claim) => claim.claimId)).size === claims.length;
}

function applyProposal(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "proposal" }>,
  artifactIndex: number,
): void {
  state.lastProposalOrRevisionIndex = artifactIndex;
  state.lastProposalOrRevisionArtifactId = artifact.deliberationArtifactId;
  state.lastProposalOrRevisionRoleId = artifact.producer.roleId;
  if (!hasUniqueClaimIds(artifact.details.claims)) {
    historyInvalid("duplicate_claim", "The proposal contains duplicate claim IDs.");
  }
  for (const claim of artifact.details.claims) {
    if (state.claims.has(claim.claimId)) {
      historyInvalid("duplicate_claim", "A proposal claim ID duplicates an earlier claim.");
    }
    state.claims.set(claim.claimId, claim.claimDigest);
  }
}

function applyObjection(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "objection" }>,
  artifactIndex: number,
): void {
  if (
    (artifact.details.reviewStatus === "approved" && artifact.details.objections.length > 0) ||
    (artifact.details.reviewStatus === "changes_requested" &&
      artifact.details.objections.length === 0)
  )
    historyInvalid(
      "objection_state_mismatch",
      "The review status and objection list are inconsistent.",
    );
  if (artifact.details.reviewStatus === "approved") {
    if (
      state.lastProposalOrRevisionArtifactId === null ||
      !artifact.previousArtifactIds.includes(state.lastProposalOrRevisionArtifactId) ||
      artifact.producer.roleId === state.lastProposalOrRevisionRoleId
    )
      historyInvalid(
        "independent_review_missing",
        "The independent approval review does not directly reference the current proposal or revision.",
      );
    state.lastApprovedReviewIndex = artifactIndex;
  }
  for (const objection of artifact.details.objections) {
    if (state.objections.has(objection.objectionId)) {
      historyInvalid("duplicate_objection", "The objection ID is duplicated.");
    }
    if (objection.targetClaimIds.some((claimId) => !state.claims.has(claimId))) {
      historyInvalid(
        "objection_state_mismatch",
        "The objection targets a claim that does not exist.",
      );
    }
    state.objections.set(objection.objectionId, {
      blocking: objection.blocking,
      resolved: false,
      targetClaimIds: objection.targetClaimIds,
    });
  }
}

function applyRevision(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "revision" }>,
  artifactIndex: number,
): void {
  state.lastProposalOrRevisionIndex = artifactIndex;
  state.lastProposalOrRevisionArtifactId = artifact.deliberationArtifactId;
  state.lastProposalOrRevisionRoleId = artifact.producer.roleId;
  const revised = state.artifactsById.get(artifact.details.revisesArtifactId);
  if (
    !revised ||
    (revised.kind !== "proposal" && revised.kind !== "revision") ||
    !artifact.previousArtifactIds.includes(revised.deliberationArtifactId)
  )
    historyInvalid(
      "revision_link_invalid",
      "The revision does not link directly to the preceding proposal or revision.",
    );
  if (!hasUniqueClaimIds(artifact.details.claims)) {
    historyInvalid("duplicate_claim", "The revision contains duplicate claim IDs.");
  }
  const revisedClaimIds = new Set(artifact.details.claims.map((claim) => claim.claimId));
  for (const objectionId of artifact.details.resolvesObjectionIds) {
    const objection = state.objections.get(objectionId);
    if (
      !objection ||
      objection.resolved ||
      objection.targetClaimIds.some((claimId) => !revisedClaimIds.has(claimId))
    )
      historyInvalid(
        "revision_resolution_invalid",
        "The revision's objection-resolution coordinates or modified claim scope are invalid.",
      );
    objection.resolved = true;
  }
  for (const claim of artifact.details.claims) state.claims.set(claim.claimId, claim.claimDigest);
}

function applyVerification(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "verification" }>,
  verificationById: ReadonlyMap<string, DeliberationVerificationEvidence>,
): void {
  if (
    !hasUniqueClaimIds(artifact.details.targetClaims) ||
    artifact.details.targetClaims.some(
      (claim) => state.claims.get(claim.claimId) !== claim.claimDigest,
    )
  )
    historyInvalid(
      "stale_claim_verification",
      "The verification targets a version other than the current claim version.",
    );
  const evidence = verificationById.get(artifact.details.verificationId);
  if (
    !evidence ||
    evidence.result.suiteId !== artifact.details.suiteId ||
    evidence.result.status !== artifact.details.status ||
    evidence.resultArtifact.artifactId !== artifact.details.resultArtifactId ||
    evidence.resultArtifact.contentHash !== artifact.details.resultHash
  ) {
    throw new DeliberationError(
      "verification_evidence_invalid",
      "verification_coordinate_mismatch",
      "The verification artifact differs from the actual suite result.",
    );
  }
  if (evidence.result.status !== "passed") return;
  state.passedVerificationArtifactIds.push(artifact.deliberationArtifactId);
  state.passedVerificationSuiteIds.add(evidence.result.suiteId);
  const coveredClaims =
    state.passedClaimIdsBySuite.get(evidence.result.suiteId) ?? new Set<string>();
  for (const claim of artifact.details.targetClaims) coveredClaims.add(claim.claimId);
  state.passedClaimIdsBySuite.set(evidence.result.suiteId, coveredClaims);
}

function applyDecision(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "decision" }>,
): void {
  if (state.decision !== null)
    historyInvalid("duplicate_decision", "Only one decision artifact may be recorded.");
  if (artifact.details.adoptedClaimIds.some((claimId) => !state.claims.has(claimId))) {
    historyInvalid("decision_claim_invalid", "The decision adopts a claim that does not exist.");
  }
  if (
    !exactSet(
      artifact.details.verificationArtifactIds,
      new Set(state.passedVerificationArtifactIds),
    )
  ) {
    historyInvalid(
      "decision_verification_mismatch",
      "The decision verification list differs from the actual passing results.",
    );
  }
  const openBlocking = new Set(
    [...state.objections.entries()]
      .filter(([, value]) => value.blocking && !value.resolved)
      .map(([id]) => id),
  );
  if (!exactSet(artifact.details.unresolvedObjectionIds, openBlocking)) {
    historyInvalid(
      "objection_state_mismatch",
      "The decision's unresolved objection list differs from the actual objection state.",
    );
  }
  state.decision = artifact;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported deliberation artifact kind: ${String(value)}`);
}

export function applyArtifactTransition(input: {
  state: DeliberationHistoryState;
  artifact: DeliberationArtifact;
  artifactIndex: number;
  verificationById: ReadonlyMap<string, DeliberationVerificationEvidence>;
}): void {
  const { state, artifact, artifactIndex, verificationById } = input;
  switch (artifact.kind) {
    case "proposal":
      applyProposal(state, artifact, artifactIndex);
      break;
    case "objection":
      applyObjection(state, artifact, artifactIndex);
      break;
    case "revision":
      applyRevision(state, artifact, artifactIndex);
      break;
    case "verification":
      applyVerification(state, artifact, verificationById);
      break;
    case "decision":
      applyDecision(state, artifact);
      break;
    default:
      assertNever(artifact);
  }
}
