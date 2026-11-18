import {
  documentFreshnessAutoApplicableHunks,
  documentFreshnessUserOwnedChange,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";

import {
  applyLervoManagedFreshnessHunks,
  applyVerifiedFreshnessArchive,
} from "./freshness-apply.js";
import type { FreshnessStorage } from "./freshness-document-io.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";

/**
 * ADR-0561: Lervo applies a `verified` candidate itself, with no owner step: every pending edit
 * hunk that needs no cross-check or has its required agreement, or the agreed archive. Every other
 * state waits; the result is the candidate after the apply, or unchanged when nothing applied.
 */
export async function applyVerifiedFreshness(
  context: { storage: FreshnessStorage; now(): Date },
  candidate: DocumentFreshnessCandidateV1,
): Promise<DocumentFreshnessCandidateV1> {
  if (candidate.state !== "verified") return candidate;
  // AGENTS.md invariant 5: a candidate whose remaining change writes only user-owned bytes, such
  // as one stored before this rule, becomes a suggestion instead of an apply.
  if (documentFreshnessUserOwnedChange(candidate)) {
    const suggested: DocumentFreshnessCandidateV1 = {
      ...candidate,
      state: "suggested",
      updatedAt: context.now().toISOString(),
    };
    await writeFreshnessCandidate(context.storage.paths.repositoryRoot, suggested);
    return suggested;
  }
  if (candidate.operation === "archive" && candidate.archive !== null)
    return applyVerifiedFreshnessArchive({
      storage: context.storage,
      candidate,
      now: context.now(),
    });
  const automatic = documentFreshnessAutoApplicableHunks(candidate);
  if (candidate.operation !== "edit" || automatic.length === 0) return candidate;
  // Lervo-managed hunks apply; user-owned hunks stay pending as the suggestion.
  return applyLervoManagedFreshnessHunks({
    storage: context.storage,
    candidate,
    hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
    now: context.now(),
  });
}
