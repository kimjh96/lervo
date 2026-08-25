import type {
  WritingContract,
  WritingEvaluation,
  WritingPublicationPermit,
  WritingSurface,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

export interface WritingArtifactCoordinate {
  artifactId: string;
  uri: string;
  mediaType: "text/markdown; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface WritingEvaluationArtifactCoordinate {
  artifactId: string;
  uri: string;
  mediaType: "application/vnd.lervo.writing-evaluation+json; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface SemanticWritingCheckRequest {
  checkId: string;
  requirement: string;
}

export interface SemanticWritingEvaluationRequest {
  writingPolicyId: string;
  locale: string;
  surface: WritingSurface;
  audience: WritingContract["audience"];
  register: WritingContract["prose"]["register"];
  artifactId: string;
  contentHash: string;
  content: string;
  checks: readonly SemanticWritingCheckRequest[];
}

export interface SemanticWritingEvaluationResponse {
  evaluator: { kind: "model" | "human"; evaluatorId: string };
  checks: readonly {
    checkId: string;
    status: "passed" | "failed";
    violationCount: number;
  }[];
}

export interface WritingSemanticEvaluator {
  evaluate(request: SemanticWritingEvaluationRequest): Promise<SemanticWritingEvaluationResponse>;
}

export type SemanticEvaluationStatus = "completed" | "not_run" | "failed" | "invalid";

interface WritingPublicationResultBase {
  evaluation: WritingEvaluation;
  evaluationArtifact: WritingEvaluationArtifactCoordinate;
  semanticEvaluationStatus: SemanticEvaluationStatus;
}

export type WritingPublicationResult =
  | (WritingPublicationResultBase & {
      status: "allowed";
      permit: WritingPublicationPermit;
      content: string;
      missingChecks: [];
      failedChecks: [];
      coordinateMismatch: false;
    })
  | (WritingPublicationResultBase & {
      status: "blocked";
      failure: "writing_verification_failed";
      permit: null;
      content: null;
      missingChecks: string[];
      failedChecks: string[];
      coordinateMismatch: boolean;
    });

export interface EvaluateWritingPublicationInput {
  artifact: WritingArtifactCoordinate;
  contract: WritingContract;
  surface: WritingSurface;
  artifactStore: ArtifactStore;
  semanticEvaluator?: WritingSemanticEvaluator;
}

export interface ReadPublishableWritingInput {
  artifact: WritingArtifactCoordinate;
  evaluation: WritingEvaluation;
  evaluationArtifact: WritingEvaluationArtifactCoordinate;
  permit: WritingPublicationPermit;
  contract: WritingContract;
  surface: WritingSurface;
  artifactStore: ArtifactStore;
}

export type WritingPublicationErrorCode =
  | "artifact_contract_invalid"
  | "artifact_storage_failed"
  | "evaluation_contract_invalid"
  | "invalid_writing_request"
  | "publication_permit_invalid";

export class WritingPublicationError extends Error {
  constructor(
    readonly code: WritingPublicationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WritingPublicationError";
  }
}
