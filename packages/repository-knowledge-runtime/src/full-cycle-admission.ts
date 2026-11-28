import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { holdProcessPresence } from "@lervo/project-storage";
import { isSqliteLockContention } from "@lervo/sqlite-connection";

import { sha256 } from "@lervo/repository-knowledge";

import { othersWaiting, update, wakeWaiters } from "./full-cycle-admission-queue.js";
import { identifiedFailure, POLL_MILLISECONDS } from "./full-cycle-admission-store.js";
import { issueAttention } from "./repository-watch-state.js";
import {
  PRIORITY_ADVANCE_MILLISECONDS,
  waitForAdmission,
  wakeSequence,
} from "./full-cycle-admission-wait.js";

const LEASE_MILLISECONDS = 10 * 60_000;
/** A holder renews this often, or ten times per lease when its lease is shorter. */
const RENEW_MILLISECONDS = 60_000;
/**
 * ADR-0577: how long `confirm()` retries lock contention before it answers `unconfirmed`. One
 * attempt can wait out the 5-second busy timeout, and ADR-0576 saw convoys outlast it, so the
 * budget allows several attempts. It is measured on the monotonic clock, because the answer must
 * not depend on a wall clock that can step back.
 */
const CONFIRM_CONTENTION_WAIT_MILLISECONDS = 30_000;

/**
 * - `resident`: a background full cycle; it takes its turn in arrival order.
 * - `upgrade`: `lervo upgrade --apply`; it goes ahead of waiting residents, and a running cycle
 *   stops at its next stage boundary.
 * - `retention`: ADR-0660's retention-only slice; admitted at once when nothing holds or waits,
 *   otherwise refused with `knowledge_admission_occupied`. It never queues, so no running cycle
 *   is asked to yield for it.
 */
export type FullCycleAdmissionPriority = "resident" | "upgrade" | "retention";

/**
 * - `held`: this holder still holds the admission.
 * - `lost`: another holder was admitted after this lease lapsed. A loss is final.
 * - `unconfirmed`: lock contention outlasted the retry budget, so neither is proven.
 */
export type FullCycleAdmissionConfirmation = "held" | "lost" | "unconfirmed";

export interface FullCycleAdmission {
  release(): Promise<void>;
  /**
   * ADR-0485: whether another repository is waiting for its turn. The holder yields at its next
   * stage boundary, so one long cycle cannot starve every other resident on the host.
   */
  contended(): Promise<boolean>;
  /**
   * ADR-0574: whether an upgrade is waiting. The holder stops at its next stage boundary, before
   * starting any further stage, instead of after its next convergence stage.
   */
  preempted(): Promise<boolean>;
  /**
   * ADR-0577: whether this holder still holds the admission, confirmed against the database and
   * renewed in the same statement. Admission replaces the holder row, and its nonce never comes
   * back, so `held` also proves that no other holder was admitted since this one. Only `held`
   * lets a holder act: contention past the retry budget answers `unconfirmed`, and other
   * database failures throw.
   */
  confirm(): Promise<FullCycleAdmissionConfirmation>;
}

/**
 * ADR-0602: listeners for a wake of a held admission's presence in this process, which an
 * upgrade sends when it starts waiting; `abandonProviderCallOnUpgrade` checks then instead of
 * polling. `admissionSignalsHeld` counts the held admissions that can be woken.
 */
const admissionSignals = new Set<() => void>();
let signalCapableHolders = 0;

export function onHeldAdmissionSignal(listener: () => void): () => void {
  admissionSignals.add(listener);
  return () => admissionSignals.delete(listener);
}

export function admissionSignalsHeld(): boolean {
  return signalCapableHolders > 0;
}

/** The host admission directory a resident shares with every other resident on its host. */
export function fullCycleAdmissionDirectory(directory?: string): string {
  return directory ?? resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
}

/**
 * One full knowledge cycle per host at a time, so co-hosted residents serialise their bursts.
 * Upgrades are admitted first, then residents, each in arrival order. Waiting ends on abort with
 * `knowledge_cancelled`, which withdraws the waiter; a dead or expired holder never blocks.
 */
export async function acquireFullCycleAdmission(input: {
  repositoryRoot: string;
  signal: AbortSignal;
  directory?: string;
  pollMilliseconds?: number;
  priority?: FullCycleAdmissionPriority;
  /**
   * ADR-0576: how long `release()` retries lock contention. By default it retries until the
   * lease lapses, which a long-lived resident needs because its live process keeps the row held.
   * A short-lived command gives up sooner: its holder row stops counting when its process exits.
   */
  releaseContentionWaitMilliseconds?: number;
  /** ADR-0577: how long `confirm()` retries lock contention; 30 seconds by default. */
  confirmContentionWaitMilliseconds?: number;
  /**
   * ADR-0577: how long the lease lasts without renewal; ten minutes by default. A holder whose
   * event loop can stall longer, such as an upgrade under host load, asks for more. A dead
   * holder still frees the slot at once.
   */
  leaseMilliseconds?: number;
  onWait?: () => void;
}): Promise<FullCycleAdmission> {
  const directory = fullCycleAdmissionDirectory(input.directory);
  const repositoryHash = sha256(resolve(input.repositoryRoot));
  const nonce = randomUUID();
  const since = Date.now() - (input.priority === "upgrade" ? PRIORITY_ADVANCE_MILLISECONDS : 0);
  const leaseMilliseconds = input.leaseMilliseconds ?? LEASE_MILLISECONDS;
  // ADR-0602: this acquisition's presence: its liveness for every other process, and the channel
  // a release, a departure or an upgrade wakes it through.
  const wakes = wakeSequence();
  let holding = false;
  const presence = holdProcessPresence({
    onWake: () => {
      wakes.wake();
      if (holding) for (const listener of [...admissionSignals]) listener();
    },
  });
  await presence.ready;
  const presenceToken = presence.issue() === null ? presence.token : null;
  // A holder or waiter ahead whose exit cannot be seen is attention while this waiter waits.
  const exitWaitIssues = issueAttention(input.repositoryRoot, "process_exit_wait_unavailable");
  let admittedAt: number;
  try {
    admittedAt = await waitForAdmission({
      directory,
      repositoryHash,
      nonce,
      since,
      leaseMilliseconds,
      immediate: input.priority === "retention",
      signal: input.signal,
      pollMilliseconds: input.pollMilliseconds ?? POLL_MILLISECONDS,
      presence: presenceToken,
      wakes: presenceToken === null ? null : wakes,
      ...(input.onWait === undefined ? {} : { onWait: input.onWait }),
      onIssue: exitWaitIssues.report,
    });
  } catch (error) {
    presence.release();
    throw error;
  } finally {
    await exitWaitIssues.clear();
  }
  holding = true;
  if (presenceToken !== null) signalCapableHolders += 1;
  let counted = presenceToken !== null;
  const uncount = () => {
    if (counted) signalCapableHolders -= 1;
    counted = false;
  };
  /** The latest expiry this holder wrote and saw applied; the row never holds an earlier one. */
  let expiresAt = admittedAt + leaseMilliseconds;
  let lost = false;
  let released = false;
  // ADR-0577: renewal matches this holder's nonce. Zero changed rows mean another holder was
  // admitted after this lease lapsed, so the admission is lost for good. `max` keeps a slower
  // renewal from shortening a later one. Lock contention leaves the answer open.
  const renew = async (): Promise<"held" | "lost" | "contended"> => {
    if (lost || released) return "lost";
    const renewed = Date.now() + leaseMilliseconds;
    let changes: number;
    try {
      changes = await update(
        directory,
        "UPDATE holder SET expires_at=max(expires_at,?) WHERE slot=1 AND nonce=?",
        renewed,
        nonce,
      );
    } catch (error) {
      if (isSqliteLockContention(error)) return "contended";
      throw identifiedFailure(error);
    }
    if (changes !== 1) {
      lost = true;
      clearInterval(renewal);
      return "lost";
    }
    expiresAt = Math.max(expiresAt, renewed);
    return "held";
  };
  // The timer only renews; a contended renewal waits for the next tick.
  const renewal = setInterval(
    () => void renew().catch(() => undefined),
    Math.min(RENEW_MILLISECONDS, Math.max(1, Math.floor(leaseMilliseconds / 10))),
  );
  renewal.unref();
  return {
    confirm: async () => {
      const giveUpAt =
        performance.now() +
        (input.confirmContentionWaitMilliseconds ?? CONFIRM_CONTENTION_WAIT_MILLISECONDS);
      for (;;) {
        const answer = await renew();
        if (answer !== "contended") return answer;
        if (performance.now() >= giveUpAt) return "unconfirmed";
        await sleep(input.pollMilliseconds ?? POLL_MILLISECONDS);
      }
    },
    contended: () => othersWaiting(directory, nonce, Date.now()).catch(() => false),
    preempted: () => {
      const now = Date.now();
      return othersWaiting(directory, nonce, now, now - PRIORITY_ADVANCE_MILLISECONDS / 2).catch(
        () => false,
      );
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(renewal);
      // ADR-0576: contention delays the release instead of failing it. Once the lease has
      // lapsed, no reader treats the row as held, so the release is complete either way.
      const giveUpAt =
        input.releaseContentionWaitMilliseconds === undefined
          ? expiresAt
          : Math.min(expiresAt, Date.now() + input.releaseContentionWaitMilliseconds);
      for (;;) {
        try {
          await update(directory, "DELETE FROM holder WHERE slot=1 AND nonce=?", nonce);
          holding = false;
          uncount();
          presence.release();
          // ADR-0602: the next waiter learns of the release at once, not on a poll.
          await wakeWaiters(directory, nonce).catch(() => undefined);
          return;
        } catch (error) {
          if (!isSqliteLockContention(error)) {
            uncount();
            presence.release();
            throw identifiedFailure(error);
          }
          if (Date.now() >= giveUpAt) {
            // The lease lapses with the presence: the holder's exit is the waiters' signal.
            uncount();
            presence.release();
            return;
          }
        }
        await sleep(input.pollMilliseconds ?? POLL_MILLISECONDS);
      }
    },
  };
}
