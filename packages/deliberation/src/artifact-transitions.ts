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
    historyInvalid("duplicate_claim", "Proposal claim ID가 중복되었습니다.");
  }
  for (const claim of artifact.details.claims) {
    if (state.claims.has(claim.claimId)) {
      historyInvalid("duplicate_claim", "Proposal claim ID가 앞선 주장과 중복되었습니다.");
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
    (artifact.details.reviewStatus === "changes_requested" && artifact.details.objections.length === 0)
  ) historyInvalid("objection_state_mismatch", "Review 상태와 반론 목록이 서로 다릅니다.");
  if (artifact.details.reviewStatus === "approved") {
    if (
      state.lastProposalOrRevisionArtifactId === null ||
      !artifact.previousArtifactIds.includes(state.lastProposalOrRevisionArtifactId) ||
      artifact.producer.roleId === state.lastProposalOrRevisionRoleId
    ) historyInvalid("independent_review_missing", "독립 승인 검토가 현재 proposal 또는 revision을 직접 참조하지 않습니다.");
    state.lastApprovedReviewIndex = artifactIndex;
  }
  for (const objection of artifact.details.objections) {
    if (state.objections.has(objection.objectionId)) {
      historyInvalid("duplicate_objection", "반론 ID가 중복되었습니다.");
    }
    if (objection.targetClaimIds.some((claimId) => !state.claims.has(claimId))) {
      historyInvalid("objection_state_mismatch", "반론이 존재하지 않는 주장을 대상으로 합니다.");
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
    !revised || (revised.kind !== "proposal" && revised.kind !== "revision") ||
    !artifact.previousArtifactIds.includes(revised.deliberationArtifactId)
  ) historyInvalid("revision_link_invalid", "Revision이 앞선 proposal 또는 revision에 직접 연결되지 않았습니다.");
  if (!hasUniqueClaimIds(artifact.details.claims)) {
    historyInvalid("duplicate_claim", "Revision claim ID가 중복되었습니다.");
  }
  const revisedClaimIds = new Set(artifact.details.claims.map((claim) => claim.claimId));
  for (const objectionId of artifact.details.resolvesObjectionIds) {
    const objection = state.objections.get(objectionId);
    if (
      !objection || objection.resolved ||
      objection.targetClaimIds.some((claimId) => !revisedClaimIds.has(claimId))
    ) historyInvalid("revision_resolution_invalid", "Revision의 반론 해소 좌표나 수정한 주장 범위가 유효하지 않습니다.");
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
    artifact.details.targetClaims.some((claim) =>
      state.claims.get(claim.claimId) !== claim.claimDigest)
  ) historyInvalid("stale_claim_verification", "Verification이 현재 주장 버전과 다른 대상을 가리킵니다.");
  const evidence = verificationById.get(artifact.details.verificationId);
  if (
    !evidence || evidence.result.suiteId !== artifact.details.suiteId ||
    evidence.result.status !== artifact.details.status ||
    evidence.resultArtifact.artifactId !== artifact.details.resultArtifactId ||
    evidence.resultArtifact.contentHash !== artifact.details.resultHash
  ) {
    throw new DeliberationError(
      "verification_evidence_invalid",
      "verification_coordinate_mismatch",
      "Verification artifact가 실제 suite 결과와 다릅니다.",
    );
  }
  if (evidence.result.status !== "passed") return;
  state.passedVerificationArtifactIds.push(artifact.deliberationArtifactId);
  state.passedVerificationSuiteIds.add(evidence.result.suiteId);
  const coveredClaims = state.passedClaimIdsBySuite.get(evidence.result.suiteId) ?? new Set<string>();
  for (const claim of artifact.details.targetClaims) coveredClaims.add(claim.claimId);
  state.passedClaimIdsBySuite.set(evidence.result.suiteId, coveredClaims);
}

function applyDecision(
  state: DeliberationHistoryState,
  artifact: Extract<DeliberationArtifact, { kind: "decision" }>,
): void {
  if (state.decision !== null) historyInvalid("duplicate_decision", "Decision artifact는 하나만 기록할 수 있습니다.");
  if (artifact.details.adoptedClaimIds.some((claimId) => !state.claims.has(claimId))) {
    historyInvalid("decision_claim_invalid", "Decision이 존재하지 않는 주장을 채택했습니다.");
  }
  if (!exactSet(artifact.details.verificationArtifactIds, new Set(state.passedVerificationArtifactIds))) {
    historyInvalid("decision_verification_mismatch", "Decision의 verification 목록이 실제 통과 결과와 다릅니다.");
  }
  const openBlocking = new Set([...state.objections.entries()]
    .filter(([, value]) => value.blocking && !value.resolved)
    .map(([id]) => id));
  if (!exactSet(artifact.details.unresolvedObjectionIds, openBlocking)) {
    historyInvalid("objection_state_mismatch", "Decision의 미해결 반론 목록이 실제 반론 상태와 다릅니다.");
  }
  state.decision = artifact;
}

function assertNever(value: never): never {
  throw new Error(`지원하지 않는 숙의 artifact 종류입니다: ${String(value)}`);
}

export function applyArtifactTransition(input: {
  state: DeliberationHistoryState;
  artifact: DeliberationArtifact;
  artifactIndex: number;
  verificationById: ReadonlyMap<string, DeliberationVerificationEvidence>;
}): void {
  const { state, artifact, artifactIndex, verificationById } = input;
  switch (artifact.kind) {
    case "proposal": applyProposal(state, artifact, artifactIndex); break;
    case "objection": applyObjection(state, artifact, artifactIndex); break;
    case "revision": applyRevision(state, artifact, artifactIndex); break;
    case "verification": applyVerification(state, artifact, verificationById); break;
    case "decision": applyDecision(state, artifact); break;
    default: assertNever(artifact);
  }
}
