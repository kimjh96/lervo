import type {
  DeliberationArtifact,
  DeliberationPolicy,
} from "@lervo/schemas";

import { validateDeliberationArtifact } from "./artifact-validation.js";
import {
  DeliberationError,
  type DeliberationVerificationEvidence,
} from "./types.js";
import { verificationEvidenceById } from "./verification-evidence.js";

export interface DeliberationHistoryAnalysis {
  deliberationId: string;
  lastRound: number;
  artifactIds: string[];
  lastArtifactId: string | null;
  openBlockingObjectionIds: string[];
  passedVerificationArtifactIds: string[];
  passedVerificationSuiteIds: Set<string>;
  passedClaimIdsBySuite: Map<string, Set<string>>;
  independentReviewApproved: boolean;
  decision: Extract<DeliberationArtifact, { kind: "decision" }> | null;
}

function historyInvalid(message: string): never {
  throw new DeliberationError("history_contract_invalid", message);
}

function exactSet(actual: readonly string[], expected: ReadonlySet<string>): boolean {
  return actual.length === expected.size && actual.every((value) => expected.has(value));
}

function hasUniqueClaimIds(claims: readonly { claimId: string }[]): boolean {
  return new Set(claims.map((claim) => claim.claimId)).size === claims.length;
}

export function analyzeDeliberationHistory(input: {
  policy: DeliberationPolicy;
  artifacts: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
}): DeliberationHistoryAnalysis {
  const verificationById = verificationEvidenceById(input.verificationEvidence);
  const artifactsById = new Map<string, DeliberationArtifact>();
  const claims = new Map<string, string>();
  const objections = new Map<string, {
    blocking: boolean;
    resolved: boolean;
    targetClaimIds: readonly string[];
  }>();
  const runRoles = new Map<string, string>();
  const sessionRoles = new Map<string, string>();
  const receiptSessions = new Map<string, string>();
  const passedVerificationArtifactIds: string[] = [];
  const passedVerificationSuiteIds = new Set<string>();
  const passedClaimIdsBySuite = new Map<string, Set<string>>();
  let previousRound = 0;
  let previousTime = Number.NEGATIVE_INFINITY;
  let lastProposalOrRevisionIndex = -1;
  let lastProposalOrRevisionArtifactId: string | null = null;
  let lastProposalOrRevisionRoleId: string | null = null;
  let lastApprovedReviewIndex = -1;
  let deliberationId: string | null = null;
  let decision: Extract<DeliberationArtifact, { kind: "decision" }> | null = null;

  for (const [artifactIndex, artifact] of input.artifacts.entries()) {
    validateDeliberationArtifact(artifact, input.policy);
    const createdAt = Date.parse(artifact.createdAt);
    if (
      artifactsById.has(artifact.deliberationArtifactId) ||
      artifact.round < previousRound || createdAt < previousTime ||
      (deliberationId !== null && artifact.deliberationId !== deliberationId)
    ) historyInvalid("숙의 artifact 순서, ID 또는 deliberation 좌표가 일관되지 않습니다.");
    deliberationId ??= artifact.deliberationId;
    previousRound = artifact.round;
    previousTime = createdAt;
    const existingRunRole = runRoles.get(artifact.producer.runId);
    if (existingRunRole !== undefined && existingRunRole !== artifact.producer.roleId) {
      historyInvalid("서로 다른 역할이 같은 managed run을 공유했습니다.");
    }
    runRoles.set(artifact.producer.runId, artifact.producer.roleId);
    const producerSession = artifact.producer.sessionId;
    const existingRole = sessionRoles.get(producerSession);
    if (existingRole !== undefined && existingRole !== artifact.producer.roleId) {
      historyInvalid("서로 다른 역할이 같은 provider session을 공유했습니다.");
    }
    sessionRoles.set(producerSession, artifact.producer.roleId);
    for (const receiptId of [
      ...artifact.inputContext.loadedReceiptIds,
      ...artifact.inputContext.injectedReceiptIds,
    ]) {
      const existingSession = receiptSessions.get(receiptId);
      if (existingSession !== undefined && existingSession !== producerSession) {
        historyInvalid("서로 다른 역할 session이 같은 context receipt를 재사용했습니다.");
      }
      receiptSessions.set(receiptId, producerSession);
    }
    for (const previousId of artifact.previousArtifactIds) {
      const previous = artifactsById.get(previousId);
      if (!previous || previous.round > artifact.round) {
        historyInvalid("숙의 artifact가 아직 확정되지 않은 이전 artifact를 참조합니다.");
      }
    }

    if (artifact.kind === "proposal") {
      lastProposalOrRevisionIndex = artifactIndex;
      lastProposalOrRevisionArtifactId = artifact.deliberationArtifactId;
      lastProposalOrRevisionRoleId = artifact.producer.roleId;
      if (!hasUniqueClaimIds(artifact.details.claims)) {
        historyInvalid("Proposal claim ID가 중복되었습니다.");
      }
      for (const claim of artifact.details.claims) {
        if (claims.has(claim.claimId)) historyInvalid("Proposal claim ID가 중복되었습니다.");
        claims.set(claim.claimId, claim.claimDigest);
      }
    } else if (artifact.kind === "objection") {
      if (
        (artifact.details.reviewStatus === "approved" && artifact.details.objections.length > 0) ||
        (artifact.details.reviewStatus === "changes_requested" &&
          artifact.details.objections.length === 0)
      ) historyInvalid("Review 상태와 반론 목록이 서로 다릅니다.");
      if (artifact.details.reviewStatus === "approved") {
        if (
          lastProposalOrRevisionArtifactId === null ||
          !artifact.previousArtifactIds.includes(lastProposalOrRevisionArtifactId) ||
          artifact.producer.roleId === lastProposalOrRevisionRoleId
        ) historyInvalid("승인 검토가 현재 proposal 또는 revision을 직접 참조하지 않습니다.");
        lastApprovedReviewIndex = artifactIndex;
      }
      for (const objection of artifact.details.objections) {
        if (
          objections.has(objection.objectionId) ||
          objection.targetClaimIds.some((claimId) => !claims.has(claimId))
        ) historyInvalid("반론 ID가 중복되었거나 존재하지 않는 주장을 대상으로 합니다.");
        objections.set(objection.objectionId, {
          blocking: objection.blocking,
          resolved: false,
          targetClaimIds: objection.targetClaimIds,
        });
      }
    } else if (artifact.kind === "revision") {
      lastProposalOrRevisionIndex = artifactIndex;
      lastProposalOrRevisionArtifactId = artifact.deliberationArtifactId;
      lastProposalOrRevisionRoleId = artifact.producer.roleId;
      const revised = artifactsById.get(artifact.details.revisesArtifactId);
      if (
        !revised || (revised.kind !== "proposal" && revised.kind !== "revision") ||
        !artifact.previousArtifactIds.includes(revised.deliberationArtifactId)
      ) historyInvalid("Revision이 앞선 proposal 또는 revision에 직접 연결되지 않았습니다.");
      if (!hasUniqueClaimIds(artifact.details.claims)) {
        historyInvalid("Revision claim ID가 중복되었습니다.");
      }
      for (const objectionId of artifact.details.resolvesObjectionIds) {
        const objection = objections.get(objectionId);
        const revisedClaimIds = new Set(artifact.details.claims.map((claim) => claim.claimId));
        if (
          !objection || objection.resolved ||
          objection.targetClaimIds.some((claimId) => !revisedClaimIds.has(claimId))
        ) historyInvalid("Revision의 반론 해소 좌표나 수정한 주장 범위가 유효하지 않습니다.");
        objection.resolved = true;
      }
      for (const claim of artifact.details.claims) claims.set(claim.claimId, claim.claimDigest);
    } else if (artifact.kind === "verification") {
      if (
        !hasUniqueClaimIds(artifact.details.targetClaims) ||
        artifact.details.targetClaims.some((claim) =>
        claims.get(claim.claimId) !== claim.claimDigest
        )
      ) {
        historyInvalid("Verification이 현재 주장 버전과 다른 대상을 가리킵니다.");
      }
      const evidence = verificationById.get(artifact.details.verificationId);
      if (
        !evidence || evidence.result.suiteId !== artifact.details.suiteId ||
        evidence.result.status !== artifact.details.status ||
        evidence.resultArtifact.artifactId !== artifact.details.resultArtifactId ||
        evidence.resultArtifact.contentHash !== artifact.details.resultHash
      ) {
        throw new DeliberationError(
          "verification_evidence_invalid",
          "Verification artifact가 실제 suite 결과와 다릅니다.",
        );
      }
      if (evidence.result.status === "passed") {
        passedVerificationArtifactIds.push(artifact.deliberationArtifactId);
        passedVerificationSuiteIds.add(evidence.result.suiteId);
        const coveredClaims = passedClaimIdsBySuite.get(evidence.result.suiteId) ?? new Set<string>();
        for (const claim of artifact.details.targetClaims) coveredClaims.add(claim.claimId);
        passedClaimIdsBySuite.set(evidence.result.suiteId, coveredClaims);
      }
    } else {
      if (decision !== null) historyInvalid("Decision artifact는 하나만 기록할 수 있습니다.");
      if (artifact.details.adoptedClaimIds.some((claimId) => !claims.has(claimId))) {
        historyInvalid("Decision이 존재하지 않는 주장을 채택했습니다.");
      }
      const passedIds = new Set(passedVerificationArtifactIds);
      if (!exactSet(artifact.details.verificationArtifactIds, passedIds)) {
        historyInvalid("Decision의 verification 목록이 실제 통과 결과와 다릅니다.");
      }
      const openBlocking = new Set([...objections.entries()]
        .filter(([, value]) => value.blocking && !value.resolved)
        .map(([id]) => id));
      if (!exactSet(artifact.details.unresolvedObjectionIds, openBlocking)) {
        historyInvalid("Decision의 미해결 반론 목록이 실제 반론 상태와 다릅니다.");
      }
      decision = artifact;
    }
    artifactsById.set(artifact.deliberationArtifactId, artifact);
  }
  if (decision !== null && input.artifacts.at(-1)?.deliberationArtifactId !== decision.deliberationArtifactId) {
    historyInvalid("Decision 뒤에는 다른 숙의 artifact를 기록할 수 없습니다.");
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
      "숙의 이력에 기록되지 않은 verification 근거가 포함되었습니다.",
    );
  }
  const openBlockingObjectionIds = [...objections.entries()]
    .filter(([, value]) => value.blocking && !value.resolved)
    .map(([id]) => id);
  return {
    deliberationId: deliberationId ?? "",
    lastRound: previousRound,
    artifactIds: input.artifacts.map((artifact) => artifact.deliberationArtifactId),
    lastArtifactId: input.artifacts.at(-1)?.deliberationArtifactId ?? null,
    openBlockingObjectionIds,
    passedVerificationArtifactIds,
    passedVerificationSuiteIds,
    passedClaimIdsBySuite,
    independentReviewApproved: lastApprovedReviewIndex > lastProposalOrRevisionIndex,
    decision,
  };
}
