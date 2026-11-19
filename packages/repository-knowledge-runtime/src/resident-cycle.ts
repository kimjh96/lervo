import type { ConvergenceSourceFingerprint } from "./source-fingerprint.js";
import type { ResidentCycleResult, ResidentCycleState } from "./resident-cycle-state.js";
import type { runAutonomousKnowledgeWorker } from "./worker.js";
import { residentCycleFailure } from "./resident-cycle-failure.js";

export const RESIDENT_RECONCILE_BASE_MILLISECONDS = 60_000;
export const RESIDENT_RECONCILE_CEILING_MILLISECONDS = 900_000;
/**
 * ADR-0595: an unchanged fingerprint skips the full cycle for up to an hour. Every time-based input
 * (practice window, skill day, earliest due delivery) is already in the fingerprint, so this is
 * only a backstop; observation still follows the 15-minute reconcile ceiling.
 */
export const RESIDENT_FORCED_FULL_CYCLE_MILLISECONDS = 3_600_000;
const SKIPPABLE = new Set<ResidentCycleResult>(["idle", "waiting", "attention", "held"]);
const MINIMUM_DUE_DELAY_MILLISECONDS = 1_000;

type WorkerResult = Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;

export type ResidentCycleOutcome =
  | { kind: "skipped" }
  | { kind: "completed"; result: WorkerResult }
  | { kind: "failed"; error: unknown };

/**
 * ADR-0580: when a convergence retry's next attempt lies in the future, the retry is parked, not
 * work. Returns that attempt time, or null when the result holds no parked retry.
 */
function parkedRetryAt(result: WorkerResult, now: number): number | null {
  if (result.status !== "processed" || result.convergence.state !== "retry_scheduled") return null;
  const due = Date.parse(result.convergence.retry?.nextAttemptAt ?? "");
  return Number.isFinite(due) && due > now ? due : null;
}

/**
 * The earliest future moment among the fence's observation and a parked retry. The fence was
 * observed before the cycle, so a retry the cycle itself rescheduled is known only from the result.
 */
function nextDueAt(observed: number | null, retryAt: number | null, now: number): number | null {
  const future = [observed, retryAt].filter((at): at is number => at !== null && at > now);
  return future.length === 0 ? observed : Math.min(...future);
}

export function classifyResidentCycle(result: WorkerResult, now: number): ResidentCycleResult {
  if (result.status === "waiting_owner")
    return ["waiting_owner", "ineligible", "yielding"].includes(result.owner.role)
      ? "waiting"
      : "attention";
  // ADR-0595: a held repository did nothing, so it backs off like an idle one instead of
  // spinning at the base cadence; the hold is in the fingerprint, so a release wakes it.
  if (result.status === "busy")
    return result.reason === "repository_owner_hold" ? "held" : "processed";
  if (result.outcomes.length > 0) return "processed";
  if (
    result.freshness?.status === "completed" &&
    (result.freshness.candidateCount > 0 || result.freshness.verifiedCount > 0)
  )
    return "processed";
  if (
    result.ownerTurns?.instructionCapture.status === "completed" &&
    result.ownerTurns.instructionCapture.assessedCount > 0
  )
    return "processed";
  // ADR-0580: the fence wakes the resident when the parked attempt falls due, and a due delivery
  // is never skipped, so backing off here cannot delay the attempt.
  if (parkedRetryAt(result, now) !== null) return "idle";
  switch (result.convergence.state) {
    case "idle":
      return "idle";
    case "waiting_authority":
      return "waiting";
    case "attention_required":
    case "recovery_required":
      return "attention";
    default:
      return "processed";
  }
}

/**
 * A cycle may be skipped only after an idle-class full cycle observed the same fingerprint, no
 * delivery is due, and the last full cycle is younger than the ceiling.
 */
export function residentCycleSkippable(input: {
  previous: ResidentCycleState | null;
  observed: ConvergenceSourceFingerprint | null;
  now: number;
  ceilingMilliseconds: number;
}): boolean {
  const { previous, observed, now } = input;
  if (previous === null || observed === null || previous.fingerprint === null) return false;
  if (!SKIPPABLE.has(previous.lastResult) || previous.fingerprint !== observed.fingerprint)
    return false;
  if (observed.earliestAvailableAt !== null && observed.earliestAvailableAt <= now) return false;
  if (previous.lastCycleAt === null) return false;
  const elapsed = now - Date.parse(previous.lastCycleAt);
  return elapsed >= 0 && elapsed < input.ceilingMilliseconds;
}

/**
 * `min(ceiling, base × 2^(idleStreak − 1), earliestAvailableAt − now)`, never a busy loop. The
 * streak counts consecutive idle-class cycles including the latest, so idle delays run 1, 2, 4, 8
 * and then 15 minutes, and a working cycle returns to the base.
 *
 * `observedAt` is when `earliestAvailableAt` was read. A delivery that was still in the future
 * then but fell due before the delay is computed wakes the resident at once (ADR-0580); one that
 * was already due when observed keeps the backoff, so deferred work never busy-loops.
 */
export function residentReconcileDelay(input: {
  idleStreak: number;
  now: number;
  earliestAvailableAt: number | null;
  observedAt?: number;
  baseMilliseconds: number;
  ceilingMilliseconds: number;
}): number {
  if (
    input.earliestAvailableAt !== null &&
    input.observedAt !== undefined &&
    input.earliestAvailableAt > input.observedAt &&
    input.earliestAvailableAt <= input.now
  )
    return MINIMUM_DUE_DELAY_MILLISECONDS;
  let delay = Math.min(
    input.ceilingMilliseconds,
    input.baseMilliseconds * 2 ** Math.min(Math.max(0, input.idleStreak - 1), 30),
  );
  if (input.earliestAvailableAt !== null && input.earliestAvailableAt > input.now)
    delay = Math.min(
      delay,
      Math.max(MINIMUM_DUE_DELAY_MILLISECONDS, input.earliestAvailableAt - input.now),
    );
  return delay;
}

/**
 * The validated reconcile cadence. The base and ceiling bound the backoff; the forced full cycle
 * bounds how long an unchanged fingerprint may skip and is never shorter than the ceiling.
 */
export function residentCadence(input: {
  intervalMilliseconds?: number;
  reconcileCeilingMilliseconds?: number;
  forcedFullCycleMilliseconds?: number;
}): { base: number; ceiling: number; forcedFullCycle: number } {
  const base = input.intervalMilliseconds ?? RESIDENT_RECONCILE_BASE_MILLISECONDS;
  if (!Number.isSafeInteger(base) || base < 100 || base > RESIDENT_RECONCILE_BASE_MILLISECONDS)
    throw new Error("Invalid convergence interval.");
  const ceiling = input.reconcileCeilingMilliseconds ?? RESIDENT_RECONCILE_CEILING_MILLISECONDS;
  if (
    !Number.isSafeInteger(ceiling) ||
    ceiling < base ||
    ceiling > RESIDENT_RECONCILE_CEILING_MILLISECONDS
  )
    throw new Error("Invalid convergence reconciliation ceiling.");
  const forcedFullCycle =
    input.forcedFullCycleMilliseconds ?? RESIDENT_FORCED_FULL_CYCLE_MILLISECONDS;
  if (!Number.isSafeInteger(forcedFullCycle) || forcedFullCycle < ceiling)
    throw new Error("Invalid forced full-cycle interval.");
  return { base, ceiling, forcedFullCycle };
}

/**
 * Idle, held, skipped and failed cycles back off (ADR-0595 adds held); work, a busy cycle that is
 * not a hold, and wakeups reset the streak.
 */
export function nextIdleStreak(streak: number, outcome: ResidentCycleResult | "skipped"): number {
  return outcome === "processed" ? 0 : Math.min(streak + 1, 64);
}

/** Observe once, then either skip on an unchanged fence or run one full cycle. */
export async function runResidentCycle(input: {
  repositoryRoot: string;
  previous: ResidentCycleState | null;
  now: () => number;
  ceilingMilliseconds: number;
  observe: () => ConvergenceSourceFingerprint;
  runFull: () => Promise<WorkerResult>;
}): Promise<{
  outcome: ResidentCycleOutcome;
  state: Omit<ResidentCycleState, "nextReconcileAt">;
  earliestAvailableAt: number | null;
  /** When `earliestAvailableAt` was last known to be accurate. */
  observedAt: number;
}> {
  const startedAt = input.now();
  let observed: ConvergenceSourceFingerprint | null;
  try {
    observed = input.observe();
  } catch {
    // Any unreadable fence input forfeits the skip; the full cycle reports the real failure.
    observed = null;
  }
  const previousStreak = input.previous?.idleStreak ?? 0;
  if (
    residentCycleSkippable({
      previous: input.previous,
      observed,
      now: startedAt,
      ceilingMilliseconds: input.ceilingMilliseconds,
    })
  )
    return {
      outcome: { kind: "skipped" },
      state: { ...input.previous!, idleStreak: nextIdleStreak(previousStreak, "skipped") },
      earliestAvailableAt: observed!.earliestAvailableAt,
      observedAt: startedAt,
    };
  const lastCycleAt = new Date(startedAt).toISOString();
  try {
    const result = await input.runFull();
    const finishedAt = input.now();
    const lastResult = classifyResidentCycle(result, finishedAt);
    return {
      outcome: { kind: "completed", result },
      state: {
        schemaVersion: 1,
        fingerprint: observed?.fingerprint ?? null,
        lastCycleAt,
        lastResult,
        lastFailure: null,
        idleStreak: nextIdleStreak(previousStreak, lastResult),
      },
      earliestAvailableAt: nextDueAt(
        observed?.earliestAvailableAt ?? null,
        parkedRetryAt(result, finishedAt),
        finishedAt,
      ),
      observedAt: finishedAt,
    };
  } catch (error) {
    return {
      outcome: { kind: "failed", error },
      state: {
        schemaVersion: 1,
        fingerprint: null,
        lastCycleAt,
        lastResult: "failed",
        lastFailure: {
          ...residentCycleFailure(error, input.repositoryRoot),
          at: new Date(input.now()).toISOString(),
        },
        idleStreak: nextIdleStreak(previousStreak, "failed"),
      },
      earliestAvailableAt: null,
      observedAt: input.now(),
    };
  }
}
