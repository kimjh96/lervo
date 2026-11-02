import { strongestDocumentFreshnessAuthority } from "./document-freshness-classification.js";
import type {
  DocumentFreshnessAuthority,
  DocumentFreshnessCandidateState,
  DocumentFreshnessCandidateV1,
  DocumentFreshnessCrossCheck,
  DocumentFreshnessHunk,
} from "./document-freshness-contract.js";

/**
 * Candidate state and authority derived from verified edit hunks and the Tier 0 outcome
 * (ADR-0463, ADR-0557). Agreement removes only the owner substitution for the cross-check.
 */

function autoApplicable(hunk: DocumentFreshnessHunk, crossCheck: DocumentFreshnessCrossCheck) {
  return (
    hunk.authorityRequired === "none" && (!hunk.crossCheckRequired || crossCheck === "agreement")
  );
}

/**
 * Hunks that may apply now: no authority beyond Lervo's own, and either no cross-check required
 * or Tier 0 agreement recorded on the candidate.
 */
export function documentFreshnessAutoApplicableHunks(
  candidate: Pick<DocumentFreshnessCandidateV1, "hunks" | "crossCheck">,
): DocumentFreshnessHunk[] {
  return candidate.hunks.filter((hunk) => autoApplicable(hunk, candidate.crossCheck));
}

/**
 * The verified state for deterministically verified edit hunks under a cross-check outcome.
 * Without agreement, a hunk that requires the cross-check waits for the owner, who substitutes.
 */
export function documentFreshnessVerifiedState(
  hunks: readonly DocumentFreshnessHunk[],
  crossCheck: DocumentFreshnessCrossCheck,
): DocumentFreshnessCandidateState {
  if (hunks.some((hunk) => autoApplicable(hunk, crossCheck))) return "verified";
  return crossCheck !== "agreement" && hunks.some((hunk) => hunk.crossCheckRequired)
    ? "verified_pending_cross_check"
    : "waiting_authority";
}

/**
 * Candidate authority. Without agreement, a cross-check-required hunk that needs no other
 * authority is raised to the owner; agreement removes only that substitution.
 */
export function documentFreshnessCandidateAuthority(
  hunks: readonly DocumentFreshnessHunk[],
  crossCheck: DocumentFreshnessCrossCheck,
): DocumentFreshnessAuthority {
  return strongestDocumentFreshnessAuthority(
    hunks.map((hunk) =>
      crossCheck !== "agreement" && hunk.crossCheckRequired && hunk.authorityRequired === "none"
        ? "owner"
        : hunk.authorityRequired,
    ),
  );
}
