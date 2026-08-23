import { evaluateWritingGate } from "@lervo/core";
import { validateSchema, type WritingContract } from "@lervo/schemas";

import {
  readWritingArtifact,
  storeWritingEvaluation,
  verifyEvaluationArtifact,
} from "./artifact.js";
import { createWritingEvaluation, validateWritingEvaluation } from "./evaluation.js";
import { writingEvaluationBytes } from "./integrity.js";
import {
  createWritingPublicationPermit,
  validateWritingPublicationPermit,
} from "./permit.js";
import type {
  EvaluateWritingPublicationInput,
  ReadPublishableWritingInput,
  WritingPublicationResult,
} from "./types.js";
import { WritingPublicationError } from "./types.js";

function validTimestamp(now: () => Date): string {
  const value = now();
  if (Number.isNaN(value.getTime())) {
    throw new WritingPublicationError("invalid_writing_request", "The writing verification time is invalid.");
  }
  return value.toISOString();
}

function validateWritingContract(contract: WritingContract): void {
  if (!validateSchema("writingContract", contract).valid) {
    throw new WritingPublicationError(
      "invalid_writing_request",
      "The writing policy does not satisfy its schema.",
    );
  }
}

export async function evaluateWritingPublication(
  input: EvaluateWritingPublicationInput,
  options: { now?: () => Date } = {},
): Promise<WritingPublicationResult> {
  validateWritingContract(input.contract);
  if (!input.contract.surfaces.includes(input.surface)) {
    throw new WritingPublicationError(
      "invalid_writing_request",
      `The writing policy does not allow the ${input.surface} publication surface.`,
    );
  }
  const content = await readWritingArtifact(input.artifactStore, input.artifact);
  const checkedAt = validTimestamp(options.now ?? (() => new Date()));
  const created = await createWritingEvaluation({
    content,
    artifact: input.artifact,
    contract: input.contract,
    surface: input.surface,
    ...(input.semanticEvaluator === undefined ? {} : { evaluator: input.semanticEvaluator }),
    checkedAt,
  });
  const evaluationArtifact = await storeWritingEvaluation(
    input.artifactStore,
    writingEvaluationBytes(created.evaluation),
  );
  const gate = evaluateWritingGate({
    contract: input.contract,
    evaluation: created.evaluation,
    artifactId: input.artifact.artifactId,
    contentHash: input.artifact.contentHash,
  });
  if (!gate.allowed) {
    return {
      status: "blocked",
      failure: gate.failure,
      permit: null,
      content: null,
      evaluation: created.evaluation,
      evaluationArtifact,
      semanticEvaluationStatus: created.semanticStatus,
      missingChecks: gate.missingChecks,
      failedChecks: gate.failedChecks,
      coordinateMismatch: gate.coordinateMismatch,
    };
  }
  const permit = createWritingPublicationPermit({
    contract: input.contract,
    surface: input.surface,
    evaluation: created.evaluation,
    evaluationArtifact,
    issuedAt: checkedAt,
  });
  return {
    status: "allowed",
    permit,
    content,
    evaluation: created.evaluation,
    evaluationArtifact,
    semanticEvaluationStatus: created.semanticStatus,
    missingChecks: [],
    failedChecks: [],
    coordinateMismatch: false,
  };
}

export async function readPublishableWritingArtifact(
  input: ReadPublishableWritingInput,
): Promise<string> {
  validateWritingContract(input.contract);
  validateWritingEvaluation(input.evaluation, input.contract);
  await verifyEvaluationArtifact(
    input.artifactStore,
    input.evaluationArtifact,
    writingEvaluationBytes(input.evaluation),
  );
  validateWritingPublicationPermit(input);
  if (
    input.artifact.artifactId !== input.permit.artifactId ||
    input.artifact.contentHash !== input.permit.contentHash
  ) {
    throw new WritingPublicationError(
      "publication_permit_invalid",
      "The writing artifact differs from the content in the publication permit.",
    );
  }
  return readWritingArtifact(input.artifactStore, input.artifact);
}
