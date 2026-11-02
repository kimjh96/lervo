import { documentFreshnessRequiredAgreements } from "./document-freshness-classification.js";
import type {
  DocumentFreshnessCandidateState,
  DocumentFreshnessCandidateV1,
  DocumentFreshnessCrossCheck,
  DocumentFreshnessHunk,
} from "./document-freshness-contract.js";

/**
 * Candidate state derived from verified edit hunks and the Tier 0 outcome (ADR-0463, ADR-0557,
 * ADR-0561). Lervo needs no authority: a hunk applies once it needs no cross-check, or once the
 * candidate recorded the agreement its required number of independent checks produced.
 */

function autoApplicable(hunk: DocumentFreshnessHunk, crossCheck: DocumentFreshnessCrossCheck) {
  return !hunk.crossCheckRequired || crossCheck === "agreement";
}

/** Pending hunks that may apply now: no cross-check required, or the required agreement recorded. */
export function documentFreshnessAutoApplicableHunks(
  candidate: Pick<DocumentFreshnessCandidateV1, "hunks" | "crossCheck" | "pendingHunkIds">,
): DocumentFreshnessHunk[] {
  const pending = new Set(candidate.pendingHunkIds);
  return candidate.hunks.filter(
    (hunk) => pending.has(hunk.hunkId) && autoApplicable(hunk, candidate.crossCheck),
  );
}

/**
 * The verified state for deterministically verified edit hunks under a cross-check outcome.
 * Without agreement, a hunk that requires the cross-check waits for Lervo's retried call.
 */
export function documentFreshnessVerifiedState(
  hunks: readonly DocumentFreshnessHunk[],
  crossCheck: DocumentFreshnessCrossCheck,
): DocumentFreshnessCandidateState {
  return hunks.some((hunk) => autoApplicable(hunk, crossCheck))
    ? "verified"
    : "verified_pending_cross_check";
}

/**
 * Independent agreeing checks the candidate needs before Lervo applies it: two when an archive,
 * a safety or policy hunk, or a user-owned statement hunk needs the cross-check; otherwise one.
 */
export function documentFreshnessCandidateRequiredAgreements(
  candidate: Pick<DocumentFreshnessCandidateV1, "operation" | "hunks" | "archive">,
): 1 | 2 {
  if (candidate.operation === "archive") return 2;
  return candidate.hunks.some(
    (hunk) =>
      hunk.crossCheckRequired &&
      documentFreshnessRequiredAgreements({
        ownership: hunk.ownership,
        changeClass: hunk.changeClass,
        operation: "edit",
      }) === 2,
  )
    ? 2
    : 1;
}
