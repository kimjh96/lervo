import { validateSchema, type DeliberationArtifact, type DeliberationPolicy } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing";

import {
  calculateDeliberationArtifactId,
  deliberationPolicyHash,
} from "./integrity.js";
import { policyAllowsProvider, validateDeliberationPolicy } from "./policy-validation.js";
import { DeliberationError } from "./types.js";

const responsibilityByKind = {
  proposal: "proposer",
  objection: "reviewer",
  revision: "proposer",
  verification: "verifier",
  decision: "decision_owner",
} as const;

function contentCoordinatesMatch(artifact: DeliberationArtifact): boolean {
  const digest = artifact.content.contentHash.slice(7);
  return artifact.content.artifactId === `art_${digest}` &&
    artifact.content.uri === `lervo-cas://sha256/${digest}`;
}

export function validateDeliberationArtifact(
  artifact: DeliberationArtifact,
  policy: DeliberationPolicy,
): void {
  validateDeliberationPolicy(policy);
  if (!validateSchema("deliberationArtifact", artifact).valid) {
    throw new DeliberationError(
      "artifact_contract_invalid",
      "숙의 artifact가 schema를 통과하지 못했습니다.",
    );
  }
  const participant = policy.participants.find(
    (item) => item.roleId === artifact.producer.roleId,
  );
  const permit = artifact.writingPublicationPermit;
  const createdAt = Date.parse(artifact.createdAt);
  const issuedAt = Date.parse(permit.issuedAt);
  if (
    artifact.projectId !== policy.projectId || artifact.policyId !== policy.policyId ||
    artifact.policyHash !== deliberationPolicyHash(policy) || artifact.round > policy.maxRounds ||
    participant === undefined ||
    !participant.responsibilities.includes(responsibilityByKind[artifact.kind]) ||
    !policyAllowsProvider(policy, artifact.producer.roleId, artifact.producer.provider) ||
    (artifact.kind === "decision" &&
      (artifact.producer.roleId !== policy.decisionOwnerRoleId ||
       artifact.details.decisionOwnerRoleId !== policy.decisionOwnerRoleId)) ||
    !contentCoordinatesMatch(artifact) ||
    permit.permitId !== calculateWritingPublicationPermitId(permit) ||
    permit.surface !== policy.publication.surface ||
    permit.writingPolicyId !== policy.publication.writingPolicyId ||
    permit.writingPolicyHash !== policy.publication.writingPolicyHash ||
    permit.artifactId !== artifact.content.artifactId ||
    permit.contentHash !== artifact.content.contentHash ||
    !Number.isFinite(createdAt) || !Number.isFinite(issuedAt) || issuedAt > createdAt ||
    artifact.deliberationArtifactId !== calculateDeliberationArtifactId(artifact) ||
    artifact.inputContext.loadedReceiptIds.some((receiptId) =>
      artifact.inputContext.injectedReceiptIds.includes(receiptId)
    ) ||
    (artifact.kind === "proposal"
      ? artifact.previousArtifactIds.length !== 0
      : artifact.previousArtifactIds.length === 0 ||
        artifact.inputContext.sharedContextIds.length === 0)
  ) {
    throw new DeliberationError(
      "artifact_contract_invalid",
      "숙의 artifact의 정책, 역할, provider, 내용, writing permit 또는 입력 증거 좌표가 다릅니다.",
    );
  }
}
