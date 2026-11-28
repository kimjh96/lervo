// ADR-0649: which failures while reading recorded execution evidence mean the evidence itself
// cannot be verified, as opposed to storage that is busy or code that is wrong. Only the former may
// become an omission; a locked database or a bug must surface as itself.
import { EventReadError } from "@lervo/storage-contract";
import { VerificationError } from "@lervo/verification-contract";

import { RepositoryKnowledgeError } from "./types.js";
import { VerificationHistoryError } from "./verification-completions.js";

/** Store error codes, named by the backends' own error classes, that describe the stored bytes. */
const EVIDENCE_CODES: Readonly<Record<string, ReadonlySet<string>>> = {
  EventStoreError: new Set([
    "integrity_failed",
    "event_schema_unsupported",
    "invalid_event",
    "report_corrupt",
  ]),
  // ADR-0658: `pruned` evidence was removed by retention, so it is omitted, never corrupt.
  CasError: new Set(["not_found", "pruned", "corrupt_object", "invalid_uri"]),
};

/**
 * Whether `error` says the recorded evidence is missing, altered, or unreadable as evidence: a
 * broken event chain or completion history, a missing or altered CAS original, a suite file that
 * is unsafe or invalid, or an evidence check of this package. Backends sit behind storage-contract ports, so their errors are
 * recognized by class name and code.
 */
export function isUnverifiableEvidence(error: unknown): boolean {
  if (
    (error instanceof RepositoryKnowledgeError &&
      error.code === "knowledge_evidence_source_invalid") ||
    error instanceof EventReadError ||
    error instanceof VerificationHistoryError ||
    error instanceof VerificationError
  )
    return true;
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && EVIDENCE_CODES[error.name]?.has(code) === true;
}
