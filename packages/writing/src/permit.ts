import { evaluateWritingGate } from "@lervo/core";
import type {
  WritingContract,
  WritingEvaluation,
  WritingPublicationPermit,
  WritingSurface,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { calculateWritingPublicationPermitId, writingPolicyHash } from "./integrity.js";
import { WritingPublicationError, type WritingEvaluationArtifactCoordinate } from "./types.js";

export function createWritingPublicationPermit(input: {
  contract: WritingContract;
  surface: WritingSurface;
  evaluation: WritingEvaluation;
  evaluationArtifact: WritingEvaluationArtifactCoordinate;
  issuedAt: string;
}): WritingPublicationPermit {
  const content: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface: input.surface,
    artifactId: input.evaluation.artifactId,
    contentHash: input.evaluation.contentHash,
    writingPolicyId: input.contract.writingPolicyId,
    writingPolicyHash: writingPolicyHash(input.contract),
    evaluationId: input.evaluation.evaluationId,
    evaluationHash: input.evaluationArtifact.contentHash,
    issuedAt: input.issuedAt,
  };
  const permit = { ...content, permitId: calculateWritingPublicationPermitId(content) };
  if (!validateSchema("writingPublicationPermit", permit).valid) {
    throw new WritingPublicationError(
      "publication_permit_invalid",
      "The writing publication permit does not satisfy its schema.",
    );
  }
  validateWritingPublicationPermit({
    permit,
    contract: input.contract,
    surface: input.surface,
    evaluation: input.evaluation,
    evaluationArtifact: input.evaluationArtifact,
  });
  return permit;
}

export function validateWritingPublicationPermit(input: {
  permit: WritingPublicationPermit;
  contract: WritingContract;
  surface: WritingSurface;
  evaluation: WritingEvaluation;
  evaluationArtifact: WritingEvaluationArtifactCoordinate;
}): void {
  const issuedAt = Date.parse(input.permit.issuedAt);
  const checkedAt = Date.parse(input.evaluation.checkedAt);
  const gate = evaluateWritingGate({
    contract: input.contract,
    evaluation: input.evaluation,
    artifactId: input.permit.artifactId,
    contentHash: input.permit.contentHash,
  });
  if (
    !validateSchema("writingPublicationPermit", input.permit).valid ||
    input.permit.permitId !== calculateWritingPublicationPermitId(input.permit) ||
    input.permit.surface !== input.surface ||
    !input.contract.surfaces.includes(input.surface) ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(checkedAt) ||
    issuedAt < checkedAt ||
    input.permit.writingPolicyId !== input.contract.writingPolicyId ||
    input.permit.writingPolicyHash !== writingPolicyHash(input.contract) ||
    input.permit.evaluationId !== input.evaluation.evaluationId ||
    input.permit.evaluationHash !== input.evaluationArtifact.contentHash ||
    !gate.allowed
  ) {
    throw new WritingPublicationError(
      "publication_permit_invalid",
      "The writing publication permit differs from the current content, policy, evaluation, or publication surface.",
    );
  }
}
