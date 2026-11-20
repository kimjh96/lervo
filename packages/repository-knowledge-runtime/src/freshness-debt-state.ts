import {
  documentFreshnessCrossCheckRetryAt,
  projectDocumentFreshnessDebt,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessDebt,
} from "@lervo/repository-knowledge";

import type { FreshnessCycleState } from "./freshness-state-store.js";

const HOUR = 3_600_000;
const MAXIMUM_ZERO_SUCCESS_BACKOFF = 24 * HOUR;
const ZERO_SUCCESS_ATTEMPTS = 5;

/**
 * ADR-0561 holds of the freshness stage: Lervo debt per finding and the zero-success generation
 * hold. Both are Lervo's own backoff, recorded in the rebuildable cycle state; neither waits for
 * the owner. Pure apart from the state it is given.
 */

export function freshnessZeroSuccessHoldActive(state: FreshnessCycleState, now: Date): boolean {
  const hold = state.zeroSuccessHold;
  return hold !== undefined && hold !== null && Date.parse(hold.until) > now.getTime();
}

/**
 * The zero-success hold after a cycle: none once a candidate verified today, the active hold while
 * it lasts, otherwise a new hold of one hour doubled per consecutive hold, at most one day.
 */
export function nextFreshnessZeroSuccessHold(
  state: FreshnessCycleState,
  now: Date,
): NonNullable<FreshnessCycleState["zeroSuccessHold"]> | null {
  const zeroSuccess = state.budget.attempts >= ZERO_SUCCESS_ATTEMPTS && state.budget.verified === 0;
  if (!zeroSuccess) return null;
  const previous = state.zeroSuccessHold ?? null;
  if (previous !== null && Date.parse(previous.until) > now.getTime()) return previous;
  const level = previous === null ? 0 : previous.level + 1;
  return {
    since: previous?.since ?? now.toISOString(),
    until: new Date(
      now.getTime() + Math.min(MAXIMUM_ZERO_SUCCESS_BACKOFF, HOUR * 2 ** level),
    ).toISOString(),
    level,
  };
}

/**
 * Whether a held cross-check, a debt retry, or the zero-success hold is due to run now. ADR-0598:
 * a debt retry generates again, so it counts only when today's budget can pay for one candidate,
 * like the ADR-0580 pending review; the day in the fence reopens the stage with a new budget.
 */
export function freshnessBackoffDue(
  state: FreshnessCycleState,
  candidates: readonly DocumentFreshnessCandidateV1[],
  now: Date,
  options: { debtAffordable?: boolean } = {},
): boolean {
  const hold = state.zeroSuccessHold;
  return (
    candidates.some((candidate) => {
      const retryAt = documentFreshnessCrossCheckRetryAt(candidate);
      return retryAt !== null && retryAt <= now;
    }) ||
    ((options.debtAffordable ?? true) &&
      (state.debt ?? []).some((debt) => Date.parse(debt.retryAt) <= now.getTime())) ||
    (hold !== undefined && hold !== null && Date.parse(hold.until) <= now.getTime())
  );
}

/** The debt projection of the stored candidates, carried forward from the previous cycle. */
export function nextFreshnessDebt(
  state: FreshnessCycleState,
  candidates: readonly DocumentFreshnessCandidateV1[],
  now: Date,
): DocumentFreshnessDebt[] {
  return projectDocumentFreshnessDebt({ candidates, previous: state.debt ?? [], now });
}
