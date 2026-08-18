import type { DocumentManifest, DocumentStalenessResult } from "@lervo/schemas";

export interface DocumentStalenessRepositorySnapshot {
  revision: string;
  files: Readonly<Record<string, string>>;
}

export type ManagedInputObservation =
  | { sourceId: string; status: "available"; contentHash: string }
  | { sourceId: string; status: "missing" };

export interface EvaluateDocumentStalenessInput {
  manifest: DocumentManifest;
  evaluatedAt: string;
  currentSnapshot: DocumentStalenessRepositorySnapshot;
  verifiedSnapshot?: DocumentStalenessRepositorySnapshot;
  managedInputObservations?: readonly ManagedInputObservation[];
}

export type EvaluateDocumentStalenessResult = DocumentStalenessResult;

export type DocumentStalenessErrorCode =
  | "invalid_staleness_request"
  | "staleness_contract_invalid";

export class DocumentStalenessError extends Error {
  constructor(
    readonly code: DocumentStalenessErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentStalenessError";
  }
}
