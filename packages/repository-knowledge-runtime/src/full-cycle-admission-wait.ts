import type { DatabaseSync } from "node:sqlite";

import { waitForProcessExit, wakeProcessPresence } from "@lervo/project-storage";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  tryAcquireOrWait,
  update,
  wakeWaiters,
  type AdmissionAttempt,
} from "./full-cycle-admission-queue.js";
import { nextAdmissionPoll } from "./full-cycle-admission-store.js";

/**
 * ADR-0574: an upgrade registers its turn this far in the past. Every reader orders waiters by
 * `since`, including residents of earlier releases, so the upgrade is admitted before every
 * waiting resident without a schema change, and upgrades keep arrival order among themselves.
 */
export const PRIORITY_ADVANCE_MILLISECONDS = 365 * 24 * 60 * 60_000;

/**
 * ADR-0602: waits for the first signal that can change an attempt's answer: a wake of this
 * waiter's presence (a release or a departure), the holder's or the waiter ahead's exit, the
 * holder's exact lease expiry, or abort. Only when an earlier release is in the way, the attempt
 * met lock contention, or no presence is held does it fall back to a bounded retry delay.
 */
function nextSignal(input: {
  attempt: AdmissionAttempt | null;
  woken: Promise<void> | null;
  retryMilliseconds: number;
  signal: AbortSignal;
  onIssue: (issue: string | null) => void;
}): Promise<void> {
  return new Promise((resolveSignal) => {
    const cancels: (() => void)[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      for (const cancel of cancels) cancel();
      input.signal.removeEventListener("abort", finish);
      resolveSignal();
    };
    input.signal.addEventListener("abort", finish, { once: true });
    if (input.signal.aborted) return finish();
    void input.woken?.then(finish);
    const { attempt } = input;
    if (attempt === null || attempt.legacy || input.woken === null) {
      const timer = setTimeout(finish, input.retryMilliseconds * (0.75 + Math.random() / 2));
      cancels.push(() => clearTimeout(timer));
      return;
    }
    if (attempt.holder !== null) {
      if (attempt.holder.presence !== null)
        cancels.push(
          waitForProcessExit(attempt.holder.presence, finish, { onIssue: input.onIssue }),
        );
      // The exact lease expiry: a holder that lives but stopped renewing is replaced then.
      const timer = setTimeout(finish, Math.max(0, attempt.holder.expiresAt - Date.now()) + 1);
      cancels.push(() => clearTimeout(timer));
    }
    if (attempt.ahead !== null)
      cancels.push(waitForProcessExit(attempt.ahead, finish, { onIssue: input.onIssue }));
  });
}

/** A presence's wakes as promises: each settles at the first wake after it was taken. */
export function wakeSequence(): { wake(): void; next(): Promise<void> } {
  let waiting: (() => void)[] = [];
  return {
    wake: () => {
      const current = waiting;
      waiting = [];
      for (const resolveWake of current) resolveWake();
    },
    next: () => new Promise<void>((resolveWake) => waiting.push(resolveWake)),
  };
}

/** Waits until this waiter is admitted and returns the admission time. */
export async function waitForAdmission(input: {
  directory: string;
  repositoryHash: string;
  nonce: string;
  since: number;
  leaseMilliseconds: number;
  signal: AbortSignal;
  pollMilliseconds: number;
  presence: string | null;
  wakes: { next(): Promise<void> } | null;
  onWait?: () => void;
  /** An exit wait that cannot see its process, then null once it can again. */
  onIssue?: (issue: string | null) => void;
}): Promise<number> {
  const connection: { db: DatabaseSync | null } = { db: null };
  let retry = input.pollMilliseconds;
  let wokenHolder: string | null = null;
  try {
    for (let waited = false; ; waited = true) {
      if (input.signal.aborted) {
        await update(input.directory, "DELETE FROM waiters WHERE nonce=?", input.nonce).catch(
          () => undefined,
        );
        // The waiter behind may now be first.
        await wakeWaiters(input.directory, input.nonce).catch(() => undefined);
        throw new KnowledgeConvergenceRuntimeError("knowledge_cancelled");
      }
      const now = Date.now();
      // Taken before the attempt, so a wake that lands while it runs is never lost.
      const woken = input.wakes?.next() ?? null;
      const attempt = await tryAcquireOrWait(connection, { ...input, now });
      if (attempt?.admitted === true) return now;
      if (!waited) input.onWait?.();
      // An upgrade asks each holder it waits behind to stop at its next stage boundary
      // (ADR-0574), once per holder, also when lock contention hid the holder at first.
      const holder = attempt?.holder?.presence ?? null;
      if (
        holder !== null &&
        holder !== wokenHolder &&
        input.since < now - PRIORITY_ADVANCE_MILLISECONDS / 2
      ) {
        wokenHolder = holder;
        await wakeProcessPresence(holder);
      }
      await nextSignal({
        attempt,
        woken,
        retryMilliseconds: retry,
        signal: input.signal,
        onIssue: input.onIssue ?? (() => undefined),
      });
      retry = nextAdmissionPoll(retry, input.pollMilliseconds);
    }
  } finally {
    connection.db?.close();
  }
}
