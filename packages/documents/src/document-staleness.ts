import {
  validateSchema,
  type DocumentStalenessResult,
} from "@lervo/schemas";
import { validateDocumentManifest } from "@lervo/project";

import { calculateDocumentStalenessResultId } from "./integrity.js";
import {
  evaluateManagedInputStaleness,
  evaluateRevisionStaleness,
  type StalenessSignalStatus,
} from "./document-staleness-signals.js";
import type {
  EvaluateDocumentStalenessInput,
  EvaluateDocumentStalenessResult,
} from "./document-staleness-types.js";
import { DocumentStalenessError } from "./document-staleness-types.js";
import {
  compareText,
  invalidStalenessRequest,
  normalizeStalenessTimestamp,
  snapshotsHaveSameFiles,
  validateStalenessSnapshot,
} from "./document-staleness-validation.js";

function overallStatus(
  statuses: readonly StalenessSignalStatus[],
): "current" | "stale" | "unknown" {
  if (statuses.includes("stale")) return "stale";
  return statuses.includes("unknown") ? "unknown" : "current";
}

export function evaluateDocumentStaleness(
  input: EvaluateDocumentStalenessInput,
): EvaluateDocumentStalenessResult {
  try {
    if (!validateSchema("documentManifest", input.manifest).valid) {
      invalidStalenessRequest("The document staleness manifest does not satisfy the schema.");
    }
    validateDocumentManifest(input.manifest, `${input.manifest.documentId}.yaml`);
  } catch (error) {
    if (error instanceof DocumentStalenessError) throw error;
    invalidStalenessRequest(
      "The semantic contract of the document staleness manifest is invalid.",
      { cause: error },
    );
  }
  validateStalenessSnapshot(input.currentSnapshot, "current repository snapshot");
  if (input.verifiedSnapshot !== undefined) {
    validateStalenessSnapshot(input.verifiedSnapshot, "verified repository snapshot");
    if (
      input.verifiedSnapshot.revision === input.currentSnapshot.revision &&
      !snapshotsHaveSameFiles(input.verifiedSnapshot, input.currentSnapshot)
    ) {
      invalidStalenessRequest("Repository snapshots with the same revision have different file sets.");
    }
  }

  const evaluated = normalizeStalenessTimestamp(input.evaluatedAt, "evaluatedAt");
  const verified = normalizeStalenessTimestamp(input.manifest.record.verifiedAt, "verifiedAt");
  if (evaluated.milliseconds < verified.milliseconds) {
    invalidStalenessRequest("evaluatedAt cannot be earlier than the document verifiedAt.");
  }
  const dueMilliseconds = verified.milliseconds +
    input.manifest.record.reviewIntervalDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(dueMilliseconds) || Number.isNaN(new Date(dueMilliseconds).getTime())) {
    invalidStalenessRequest("The document review expiration time cannot be calculated.");
  }
  const reviewStatus = evaluated.milliseconds >= dueMilliseconds ? "stale" : "current";

  const revision = evaluateRevisionStaleness(
    input.manifest,
    input.currentSnapshot,
    input.verifiedSnapshot,
  );
  const managedInputs = evaluateManagedInputStaleness(
    input.manifest,
    input.managedInputObservations ?? [],
  );
  const reasons = [
    ...(reviewStatus === "stale" ? ["review_interval_elapsed" as const] : []),
    ...revision.reasons,
    ...managedInputs.reasons,
  ].sort(compareText);
  const resultContent: Omit<DocumentStalenessResult, "resultId"> = {
    schemaVersion: 1,
    documentId: input.manifest.documentId,
    evaluatedAt: evaluated.value,
    status: overallStatus([
      reviewStatus,
      revision.documentPath.status,
      revision.connectedPaths.status,
      ...(managedInputs.signal.status === "not_applicable"
        ? []
        : [managedInputs.signal.status]),
    ]),
    verifiedRevision: input.manifest.record.verifiedRevision,
    currentRevision: input.currentSnapshot.revision,
    signals: {
      reviewInterval: {
        status: reviewStatus,
        dueAt: new Date(dueMilliseconds).toISOString(),
      },
      documentPath: revision.documentPath,
      connectedPaths: revision.connectedPaths,
      managedInputs: managedInputs.signal,
    },
    reasons,
  };
  const result: DocumentStalenessResult = {
    ...resultContent,
    resultId: calculateDocumentStalenessResultId(resultContent),
  };
  if (!validateSchema("documentStalenessResult", result).valid) {
    throw new DocumentStalenessError(
      "staleness_contract_invalid",
      "The document staleness result cannot be made schema-valid.",
    );
  }
  return result;
}
