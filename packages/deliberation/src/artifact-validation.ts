import { validateSchema, type DeliberationArtifact, type DeliberationPolicy } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import {
  calculateDeliberationArtifactId,
  deliberationPolicyHash,
} from "./integrity.js";
import { policyAllowsProvider, validateDeliberationPolicy } from "./policy-validation.js";
import { DeliberationError, type DeliberationErrorReason } from "./types.js";

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

function artifactInvalid(
  reason: DeliberationErrorReason,
  message: string,
): never {
  throw new DeliberationError("artifact_contract_invalid", reason, message);
}

export function validateDeliberationArtifact(
  artifact: DeliberationArtifact,
  policy: DeliberationPolicy,
): void {
  validateDeliberationPolicy(policy);
  validateDeliberationArtifactAgainstValidatedPolicy(artifact, policy);
}

export function validateDeliberationArtifactAgainstValidatedPolicy(
  artifact: DeliberationArtifact,
  policy: DeliberationPolicy,
): void {
  if (!validateSchema("deliberationArtifact", artifact).valid) {
    throw new DeliberationError(
      "artifact_contract_invalid",
      "artifact_schema_invalid",
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
    artifact.policyHash !== deliberationPolicyHash(policy) || artifact.round > policy.maxRounds
  ) artifactInvalid("artifact_policy_mismatch", "숙의 artifact의 project, policy 또는 회차가 다릅니다.");
  if (participant === undefined ||
    !participant.responsibilities.includes(responsibilityByKind[artifact.kind])) {
    artifactInvalid("role_responsibility_mismatch", "Artifact 생산 역할에 필요한 책임이 없습니다.");
  }
  if (!policyAllowsProvider(policy, artifact.producer.roleId, artifact.producer.provider)) {
    artifactInvalid("provider_not_allowed", "Artifact provider가 역할 정책에 허용되지 않았습니다.");
  }
  if (artifact.kind === "decision" &&
    (artifact.producer.roleId !== policy.decisionOwnerRoleId ||
      artifact.details.decisionOwnerRoleId !== policy.decisionOwnerRoleId)) {
    artifactInvalid("decision_owner_mismatch", "Decision 생산자와 정책의 결정 책임자가 다릅니다.");
  }
  if (!contentCoordinatesMatch(artifact)) {
    artifactInvalid("content_coordinate_mismatch", "Artifact CAS 좌표가 content hash와 다릅니다.");
  }
  if (
    permit.permitId !== calculateWritingPublicationPermitId(permit) ||
    permit.surface !== policy.publication.surface ||
    permit.writingPolicyId !== policy.publication.writingPolicyId ||
    permit.writingPolicyHash !== policy.publication.writingPolicyHash ||
    permit.artifactId !== artifact.content.artifactId ||
    permit.contentHash !== artifact.content.contentHash
  ) artifactInvalid("writing_permit_mismatch", "Writing permit가 정책 또는 artifact 내용과 다릅니다.");
  if (!Number.isFinite(createdAt) || !Number.isFinite(issuedAt) || issuedAt > createdAt) {
    artifactInvalid("timestamp_invalid", "Artifact 또는 writing permit 시각이 유효하지 않습니다.");
  }
  if (artifact.deliberationArtifactId !== calculateDeliberationArtifactId(artifact)) {
    artifactInvalid("artifact_id_mismatch", "Artifact ID가 canonical metadata와 다릅니다.");
  }
  if (artifact.inputContext.loadedReceiptIds.some((receiptId) =>
    artifact.inputContext.injectedReceiptIds.includes(receiptId))) {
    artifactInvalid("context_receipt_overlap", "Loaded와 injected context receipt가 겹칩니다.");
  }
  if (artifact.kind === "proposal") {
    if (artifact.previousArtifactIds.length !== 0) {
      artifactInvalid("previous_artifact_context_missing", "Proposal은 이전 artifact를 참조할 수 없습니다.");
    }
  } else if (
    artifact.previousArtifactIds.length === 0 ||
    artifact.inputContext.sharedContextIds.length === 0
  ) {
    artifactInvalid(
      "previous_artifact_context_missing",
      "후속 artifact에 이전 artifact 또는 shared context 좌표가 없습니다.",
    );
  }
}
