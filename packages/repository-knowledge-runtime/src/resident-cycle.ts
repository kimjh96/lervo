import type { ConvergenceSourceFingerprint } from "./source-fingerprint.js";
import type { ResidentCycleResult, ResidentCycleState } from "./resident-cycle-state.js";
import type { runAutonomousKnowledgeWorker } from "./worker.js";

export const RESIDENT_RECONCILE_BASE_MILLISECONDS = 60_000;
export const RESIDENT_RECONCILE_CEILING_MILLISECONDS = 900_000;
const SKIPPABLE = new Set<ResidentCycleResult>(["idle", "waiting", "attention"]);
const MINIMUM_DUE_DELAY_MILLISECONDS = 1_000;

type WorkerResult = Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;

export type ResidentCycleOutcome =
  | { kind: "skipped" }
  | { kind: "completed"; result: WorkerResult }
  | { kind: "failed"; error: unknown };

export function classifyResidentCycle(result: WorkerResult): ResidentCycleResult {
  if (result.status === "waiting_owner")
    return ["waiting_owner", "ineligible", "yielding"].includes(result.owner.role)
      ? "waiting"
      : "attention";
  if (result.status === "busy" || result.outcomes.length > 0) return "processed";
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
 */
export function residentReconcileDelay(input: {
  idleStreak: number;
  now: number;
  earliestAvailableAt: number | null;
  baseMilliseconds: number;
  ceilingMilliseconds: number;
}): number {
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

/** Idle, skipped and failed cycles back off; work, busy owners and wakeups reset the streak. */
export function nextIdleStreak(streak: number, outcome: ResidentCycleResult | "skipped"): number {
  return outcome === "processed" ? 0 : Math.min(streak + 1, 64);
}

/** Observe once, then either skip on an unchanged fence or run one full cycle. */
export async function runResidentCycle(input: {
  previous: ResidentCycleState | null;
  now: () => number;
  ceilingMilliseconds: number;
  observe: () => ConvergenceSourceFingerprint;
  runFull: () => Promise<WorkerResult>;
}): Promise<{
  outcome: ResidentCycleOutcome;
  state: Omit<ResidentCycleState, "nextReconcileAt">;
  earliestAvailableAt: number | null;
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
    };
  const lastCycleAt = new Date(startedAt).toISOString();
  try {
    const result = await input.runFull();
    const lastResult = classifyResidentCycle(result);
    return {
      outcome: { kind: "completed", result },
      state: {
        schemaVersion: 1,
        fingerprint: observed?.fingerprint ?? null,
        lastCycleAt,
        lastResult,
        idleStreak: nextIdleStreak(previousStreak, lastResult),
      },
      earliestAvailableAt: observed?.earliestAvailableAt ?? null,
    };
  } catch (error) {
    return {
      outcome: { kind: "failed", error },
      state: {
        schemaVersion: 1,
        fingerprint: null,
        lastCycleAt,
        lastResult: "failed",
        idleStreak: nextIdleStreak(previousStreak, "failed"),
      },
      earliestAvailableAt: null,
    };
  }
}
