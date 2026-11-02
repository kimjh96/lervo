import {
  documentFreshnessCrossCheckRetryAt,
  pendingDocumentFreshnessCrossCheck,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";

import { applyVerifiedFreshness } from "./freshness-auto-apply.js";
import {
  deferPendingFreshnessCrossCheck,
  freshnessCrossCheckPending,
  runFreshnessCrossCheck,
} from "./freshness-cross-check.js";
import { DocumentFreshnessOperationError } from "./freshness-document-io.js";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import { writeFreshnessCandidate } from "./freshness-state-store.js";

/**
 * Cycle-level scheduling of Tier 0 cross-checks: re-arming calls whose retry backoff elapsed
 * (ADR-0561) and resuming pending calls in order before any new generation (ADR-0557).
 */

/**
 * ADR-0561: Lervo retries a cross-check that settled as unavailable once its backoff elapsed. The
 * candidate keeps its agreeing rounds and its stored input, and waits for the call again.
 */
export async function rearmFreshnessCrossChecks(
  context: FreshnessGenerationContext,
  candidates: readonly DocumentFreshnessCandidateV1[],
): Promise<DocumentFreshnessCandidateV1[]> {
  const now = context.now();
  const result: DocumentFreshnessCandidateV1[] = [];
  for (const candidate of candidates) {
    const retryAt = documentFreshnessCrossCheckRetryAt(candidate);
    const review = candidate.crossCheckReview;
    if (retryAt === null || retryAt > now || review === undefined) {
      result.push(candidate);
      continue;
    }
    const next: DocumentFreshnessCandidateV1 = {
      ...candidate,
      state: "generated",
      crossCheckReview: {
        ...pendingDocumentFreshnessCrossCheck(review.inputHash),
        retries: (review.retries ?? 0) + 1,
      },
      updatedAt: now.toISOString(),
    };
    await writeFreshnessCandidate(context.storage.paths.repositoryRoot, next);
    result.push(next);
  }
  return result;
}

/**
 * Resumes cross-checks a previous turn left pending, oldest first, until one stays pending for
 * lack of provider capacity. A settled agreement lets Lervo apply when effects allow.
 */
export async function resumePendingFreshnessCrossChecks(input: {
  context: FreshnessGenerationContext;
  candidates: readonly DocumentFreshnessCandidateV1[];
  maximumTokens: number;
  /** Tokens left in today's freshness budget; each resumed call is bounded by what remains. */
  dailyRemaining: number;
  /** Persists each settled spend before anything else runs, so a later failure cannot lose it. */
  recordSpend: (tokens: number) => Promise<void>;
  autoApply: boolean;
}): Promise<{
  tokensObserved: number;
  verifiedCount: number;
  appliedCount: number;
  disagreements: number;
  pending: boolean;
}> {
  const totals = {
    tokensObserved: 0,
    verifiedCount: 0,
    appliedCount: 0,
    disagreements: 0,
    pending: false,
  };
  const pending = input.candidates
    .filter(freshnessCrossCheckPending)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const [index, candidate] of pending.entries()) {
    const result = await runFreshnessCrossCheck({
      context: input.context,
      candidate,
      maximumTokens: input.maximumTokens,
      dailyRemaining: Math.max(0, input.dailyRemaining - totals.tokensObserved),
      recordSpend: input.recordSpend,
    });
    totals.tokensObserved += result.tokensObserved;
    if (result.status === "pending") {
      totals.pending = true;
      // Candidates this turn could not reach age by the same capacity deferral, each to its bound.
      if (result.candidate.crossCheckReview?.deferrals !== candidate.crossCheckReview?.deferrals)
        for (const waiting of pending.slice(index + 1))
          await deferPendingFreshnessCrossCheck(input.context, waiting);
      break;
    }
    if (result.candidate.state === "rejected") {
      totals.disagreements += 1;
      continue;
    }
    totals.verifiedCount += 1;
    if (!input.autoApply) continue;
    try {
      const applied = await applyVerifiedFreshness(input.context, result.candidate);
      if (applied.state === "applied" || applied.state === "partially_applied")
        totals.appliedCount += 1;
    } catch (error) {
      if (!(error instanceof DocumentFreshnessOperationError)) throw error;
    }
  }
  return totals;
}
