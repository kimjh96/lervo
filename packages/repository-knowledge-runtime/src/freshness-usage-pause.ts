import type { DocumentFreshnessCandidateV1 } from "@lervo/repository-knowledge";

import { reviewPendingFreshnessAssessment } from "./freshness-assessment.js";
import type { FreshnessGenerationContext } from "./freshness-generation.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FRESHNESS_CYCLE_PATH, type FreshnessCycleState } from "./freshness-state-store.js";

/** Reviews in a row without usage after which a provider's reviews are not paid for. */
export const FRESHNESS_USAGE_UNAVAILABLE_LIMIT = 3;
const USAGE_UNAVAILABLE_PAUSE_MS = 24 * 60 * 60_000;

/**
 * ADR-0604: the no-usage count after one review. An answer without usage counts toward the limit,
 * whatever its verdict, and the limit pauses that provider's reviews for a day; an answer with
 * usage clears the count; a review that got no answer leaves it.
 */
export function nextUsageUnavailable(
  previous: FreshnessCycleState["usageUnavailable"],
  provider: string,
  usageReported: boolean | undefined,
  now: Date,
): NonNullable<FreshnessCycleState["usageUnavailable"]> | null {
  if (usageReported === true) return null;
  if (usageReported === undefined) return previous ?? null;
  const count = previous?.provider === provider ? previous.count + 1 : 1;
  return {
    provider,
    count,
    since: previous?.provider === provider ? previous.since : now.toISOString(),
    until:
      count >= FRESHNESS_USAGE_UNAVAILABLE_LIMIT
        ? new Date(now.getTime() + USAGE_UNAVAILABLE_PAUSE_MS).toISOString()
        : null,
  };
}

/**
 * ADR-0604: ends a pause whose day is over, so it is due once and never again: the stage reopens
 * for it, and a later cycle with nothing else to do is unchanged. The count stays, so one more
 * answer without usage pauses the provider again; an answer with usage still clears it. Returns
 * whether `state` changed.
 */
export function expireUsagePause(state: FreshnessCycleState, now: Date): boolean {
  const pause = state.usageUnavailable;
  if (pause === null || pause === undefined || pause.until === null) return false;
  if (Date.parse(pause.until) > now.getTime()) return false;
  state.usageUnavailable = { ...pause, until: null };
  return true;
}

/**
 * ADR-0604: runs one no-change review unless its provider's reviews are paused for reporting no
 * usage, and records what the review showed about the provider's usage in `state`.
 */
export async function reviewUnlessUsagePaused(
  context: FreshnessGenerationContext,
  state: FreshnessCycleState,
  candidate: DocumentFreshnessCandidateV1,
  options: { now: Date; maximumTokens: number },
): Promise<{
  candidate: DocumentFreshnessCandidateV1;
  tokensObserved: number;
  deferred: string | null;
}> {
  const unpaid = state.usageUnavailable;
  if (
    unpaid !== null &&
    unpaid !== undefined &&
    unpaid.provider === context.provider &&
    unpaid.until !== null &&
    Date.parse(unpaid.until) > options.now.getTime()
  )
    return { candidate, tokensObserved: 0, deferred: "freshness_provider_usage_unavailable" };
  const review = await reviewPendingFreshnessAssessment(context, candidate, options.maximumTokens);
  state.usageUnavailable = nextUsageUnavailable(
    state.usageUnavailable,
    context.provider,
    review.usageReported,
    options.now,
  );
  return review;
}

/**
 * ADR-0604: when a provider's paused freshness reviews resume, as a wake time for the resident, or
 * null. Read synchronously from the cycle state, as the source fingerprint is; an unreadable state
 * has no pause to wake for.
 */
export function freshnessUsagePauseEndsAt(root: string, now: number): number | null {
  try {
    const state = JSON.parse(
      readFileSync(resolve(root, FRESHNESS_CYCLE_PATH), "utf8"),
    ) as Partial<FreshnessCycleState>;
    const until = state?.usageUnavailable?.until;
    const at = typeof until === "string" ? Date.parse(until) : Number.NaN;
    return Number.isFinite(at) && at > now ? at : null;
  } catch {
    return null;
  }
}
