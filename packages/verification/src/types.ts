import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

export type VerificationErrorCode =
  | "artifact_storage_failed"
  | "command_working_directory_invalid"
  | "invalid_verification_request"
  | "invalid_verification_suite"
  | "repository_changed_during_verification"
  | "repository_snapshot_failed"
  | "repository_snapshot_mismatch"
  | "result_contract_invalid"
  | "verification_layout_invalid"
  | "verification_suite_not_found";

export class VerificationError extends Error {
  constructor(
    readonly code: VerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "VerificationError";
  }
}

export interface VerificationArtifactCoordinate {
  artifactId: string;
  uri: string;
  mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8";
  contentHash: string;
  byteCount: number;
}

export interface RunVerificationSuiteInput {
  suite: VerificationSuite;
  repositoryRoot: string;
  repositoryRevision: string;
  captureRepositoryRevision: (repositoryRoot: string) => Promise<string>;
  artifactStore: ArtifactStore;
  signal?: AbortSignal;
}

export interface RunVerificationSuiteOptions {
  now?: () => Date;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface RunVerificationSuiteResult {
  result: VerificationResult;
  resultArtifact: VerificationArtifactCoordinate;
}
