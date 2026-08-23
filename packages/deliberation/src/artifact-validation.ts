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
      "The deliberation artifact does not satisfy its schema.",
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
  ) artifactInvalid("artifact_policy_mismatch", "The deliberation artifact project, policy, or round does not match.");
  if (participant === undefined ||
    !participant.responsibilities.includes(responsibilityByKind[artifact.kind])) {
    artifactInvalid("role_responsibility_mismatch", "The artifact producer role lacks the required responsibility.");
  }
  if (!policyAllowsProvider(policy, artifact.producer.roleId, artifact.producer.provider)) {
    artifactInvalid("provider_not_allowed", "The artifact provider is not allowed by the role policy.");
  }
  if (artifact.kind === "decision" &&
    (artifact.producer.roleId !== policy.decisionOwnerRoleId ||
      artifact.details.decisionOwnerRoleId !== policy.decisionOwnerRoleId)) {
    artifactInvalid("decision_owner_mismatch", "The decision producer does not match the policy decision owner.");
  }
  if (!contentCoordinatesMatch(artifact)) {
    artifactInvalid("content_coordinate_mismatch", "The artifact CAS coordinates do not match the content hash.");
  }
  if (
    permit.permitId !== calculateWritingPublicationPermitId(permit) ||
    permit.surface !== policy.publication.surface ||
    permit.writingPolicyId !== policy.publication.writingPolicyId ||
    permit.writingPolicyHash !== policy.publication.writingPolicyHash ||
    permit.artifactId !== artifact.content.artifactId ||
    permit.contentHash !== artifact.content.contentHash
  ) artifactInvalid("writing_permit_mismatch", "The writing permit does not match the policy or artifact content.");
  if (!Number.isFinite(createdAt) || !Number.isFinite(issuedAt) || issuedAt > createdAt) {
    artifactInvalid("timestamp_invalid", "The artifact or writing permit time is invalid.");
  }
  if (artifact.deliberationArtifactId !== calculateDeliberationArtifactId(artifact)) {
    artifactInvalid("artifact_id_mismatch", "The artifact ID differs from the canonical metadata.");
  }
  if (artifact.inputContext.loadedReceiptIds.some((receiptId) =>
    artifact.inputContext.injectedReceiptIds.includes(receiptId))) {
    artifactInvalid("context_receipt_overlap", "Loaded and injected context receipts overlap.");
  }
  if (artifact.kind === "proposal") {
    if (artifact.previousArtifactIds.length !== 0) {
      artifactInvalid("previous_artifact_context_missing", "A proposal cannot reference a previous artifact.");
    }
  } else if (
    artifact.previousArtifactIds.length === 0 ||
    artifact.inputContext.sharedContextIds.length === 0
  ) {
    artifactInvalid(
      "previous_artifact_context_missing",
      "A subsequent artifact is missing previous-artifact or shared-context coordinates.",
    );
  }
}
