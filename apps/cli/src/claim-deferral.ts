// When a claim cannot decide (Lervo ADE coordination, "When Lervo cannot decide"): the write goes
// ahead and the turn's end claims it. A claim that would take the scheduler lock too late stops
// before it, and a failure becomes the deferral's code.
import { CLAIM_DEFERRED } from "./claim-contract.js";

/** How long before a deadline a claim stops rather than take the scheduler lock. */
const LOCK_MARGIN_MS = 500;

/**
 * How long a claim's event write waits for another writer of the event store. The write runs under
 * the scheduler lock, so a busy store defers the claim quickly instead of holding the lock.
 */
export const CLAIM_STORE_BUSY_MS = 250;

/**
 * Checked immediately before the scheduler lock is taken: the caller has not answered without this
 * claim, and enough time remains before `deadline`, on the `performance.now()` clock, to finish
 * under the lock. Only then is `lockTaken` told, so the caller waits for the claim to finish.
 */
export function guardBeforeLock(input: {
  readonly signal?: AbortSignal;
  readonly deadline: number;
  readonly lockTaken?: () => void;
}): () => void {
  return () => {
    input.signal?.throwIfAborted();
    if (performance.now() > input.deadline - LOCK_MARGIN_MS)
      throw Object.assign(new Error("Too little time remains to claim under the lock."), {
        code: CLAIM_DEFERRED,
      });
    input.lockTaken?.();
  };
}

/** SQLite's `SQLITE_BUSY` and `SQLITE_LOCKED`: another writer held the store. */
const SQLITE_BUSY_CODES = new Set([5, 6]);

/**
 * A failure's code as a deferral carries it, such as `workforce_busy`, or `claim_deferred`. A
 * store another writer held past the claim's short wait is `workforce_busy` too.
 */
export function deferralCode(error: unknown): string {
  const failure = error as { code?: unknown; errcode?: unknown } | null;
  if (typeof failure?.errcode === "number" && SQLITE_BUSY_CODES.has(failure.errcode & 0xff))
    return "workforce_busy";
  const code = failure?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : CLAIM_DEFERRED;
}
