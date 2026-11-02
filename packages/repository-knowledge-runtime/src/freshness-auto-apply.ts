import {
  documentFreshnessAutoApplicableHunks,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";

import {
  applyLervoManagedFreshnessHunks,
  applyVerifiedFreshnessArchive,
} from "./freshness-apply.js";
import type { FreshnessStorage } from "./freshness-document-io.js";

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
  if (candidate.operation === "archive" && candidate.archive !== null)
    return applyVerifiedFreshnessArchive({
      storage: context.storage,
      candidate,
      now: context.now(),
    });
  const automatic = documentFreshnessAutoApplicableHunks(candidate);
  if (candidate.operation !== "edit" || automatic.length === 0) return candidate;
  return applyLervoManagedFreshnessHunks({
    storage: context.storage,
    candidate,
    hunkIds: new Set(automatic.map((hunk) => hunk.hunkId)),
    now: context.now(),
  });
}
