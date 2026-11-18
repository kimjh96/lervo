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
  // AGENTS.md invariant 5: user-owned bytes are never applied automatically.
  if (hunk.ownership === "user_owned") return false;
  return !hunk.crossCheckRequired || crossCheck === "agreement";
}

/**
 * AGENTS.md invariant 5 under ADR-0561: whether a candidate's remaining change would write
 * user-owned bytes only. An archive of a user-owned document, or one that rewrites links in other
 * documents, counts; so does an edit whose pending hunks are all user-owned. Lervo keeps such a
 * candidate as a suggestion (`suggested`) and never applies it. An edit that mixes Lervo-managed and
 * user-owned hunks applies the managed hunks and leaves the user-owned ones as the suggestion.
 */
export function documentFreshnessUserOwnedChange(
  candidate: Pick<DocumentFreshnessCandidateV1, "operation" | "hunks" | "archive"> & {
    pendingHunkIds?: readonly string[];
  },
): boolean {
  if (candidate.operation === "archive")
    return (
      candidate.archive === null ||
      candidate.archive.ownership === "user_owned" ||
      candidate.archive.inboundLinkRewrites.length > 0
    );
  if (candidate.operation !== "edit") return false;
  const pending = candidate.pendingHunkIds === undefined ? null : new Set(candidate.pendingHunkIds);
  const remaining = candidate.hunks.filter((hunk) => pending === null || pending.has(hunk.hunkId));
  return remaining.length > 0 && remaining.every((hunk) => hunk.ownership === "user_owned");
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
  if (hunks.some((hunk) => autoApplicable(hunk, crossCheck))) return "verified";
  // AGENTS.md invariant 5: only user-owned hunks remain, so the candidate is a suggestion.
  return hunks.length > 0 && hunks.every((hunk) => hunk.ownership === "user_owned")
    ? "suggested"
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
