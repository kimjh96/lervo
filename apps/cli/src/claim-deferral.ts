// When a claim cannot decide (Lervo ADE coordination, "When Lervo cannot decide"): the write is
// refused as unverified, never let through as if it were checked, and the agent may retry it. A
// claim that would take the scheduler lock too late stops before it, and a failure becomes the
// cause the refusal names.
import { CLAIM_DEFERRED, CLAIM_UNVERIFIED, type ClaimDecision } from "./claim-contract.js";

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

/** How many paths an unverified refusal's message names before it counts the rest. */
const NAMED_PATHS = 3;

/**
 * The refusal of a write whose claim could not be decided, with `cause`, such as `workforce_busy`
 * or `claim_deferred` for a deadline, in its message. It names no holder: none was found.
 */
export function unverifiedClaim(
  cause: string,
  paths: readonly string[],
): Extract<ClaimDecision, { decision: "deny" }> {
  const named = paths.slice(0, NAMED_PATHS).map((path) => `\`${path}\``);
  const rest = paths.length - named.length;
  const subject =
    named.length === 0
      ? "the paths this write changes are"
      : `${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""} ${paths.length === 1 ? "is" : "are"}`;
  return {
    decision: "deny",
    code: CLAIM_UNVERIFIED,
    paths: [...paths],
    holder: null,
    message:
      `Lervo stopped this write because it could not check in time whether ${subject} free of ` +
      `other conversations' work (${cause}). Nothing was written. Try the same write again. If ` +
      `Lervo keeps stopping it, continue with other paths and tell the owner which paths Lervo ` +
      `could not check.`,
  };
}
