import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { VerificationArtifactCoordinate } from "@lervo/verification-contract";

export {
  VerificationError,
  type VerificationArtifactCoordinate,
  type VerificationErrorCode,
} from "@lervo/verification-contract";

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
