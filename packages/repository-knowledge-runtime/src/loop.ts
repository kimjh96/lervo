import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";
import { runAutonomousKnowledgeWorker } from "./worker.js";
import { recordKnowledgeResidentHealth, type KnowledgeResidentState } from "./resident-health.js";
import { acquireFullCycleAdmission } from "./full-cycle-admission.js";
import { convergenceSourceFingerprint } from "./source-fingerprint.js";
import {
  readResidentCycleState,
  writeResidentCycleState,
  type ResidentCycleState,
} from "./resident-cycle-state.js";
import {
  RESIDENT_RECONCILE_BASE_MILLISECONDS,
  RESIDENT_RECONCILE_CEILING_MILLISECONDS,
  residentReconcileDelay,
  runResidentCycle,
} from "./resident-cycle.js";

type WorkerResult = Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;

function healthOf(result: WorkerResult): KnowledgeResidentState {
  if (result.status === "busy") return "busy";
  switch (result.convergence.state) {
    case "waiting_authority":
      return "waiting";
    case "attention_required":
    case "recovery_required":
      return "attention";
    default:
      return "idle";
  }
}

/**
 * The standalone host needs no Hub. Startup, event and repository wakeups, and an adaptive
 * reconciliation timer share one owner; an unchanged change fence skips the full cycle.
 */
export function startAutonomousKnowledgeWorker(input: {
  storage: ProjectStorage;
  signal?: AbortSignal;
  workerId: string;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  subscribe?: (notify: () => void) => () => void;
  onCycle?: (result: WorkerResult) => void;
  onFailure: (error: unknown) => void;
  intervalMilliseconds?: number;
  reconcileCeilingMilliseconds?: number;
}): () => Promise<void> {
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
  const root = input.storage.paths.repositoryRoot;
  const controller = new AbortController();
  const signal =
    input.signal === undefined
      ? controller.signal
      : AbortSignal.any([input.signal, controller.signal]);
  let running: Promise<void> | null = null;
  let pending = false;
  let woken = false;
  let firstWake: number | null = null;
  let lastWake: number | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let reconcile: ReturnType<typeof setTimeout> | null = null;
  let previous: ResidentCycleState | null | undefined;
  let healthState: KnowledgeResidentState = "idle";
  let healthReason: string | null = null;
  let healthWrite = Promise.resolve();
  const heartbeat = () => {
    healthWrite = healthWrite
      .then(() =>
        recordKnowledgeResidentHealth({
          repositoryRoot: root,
          workerId: input.workerId,
          state: healthState,
          reason: healthReason,
        }),
      )
      .catch(input.onFailure);
  };
  const report = (state: KnowledgeResidentState, reason: string | null) => {
    healthState = state;
    healthReason = reason;
    heartbeat();
  };
  const runFull = async () => {
    report("running", null);
    const admission = await acquireFullCycleAdmission({
      repositoryRoot: root,
      signal,
      ...(input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory }),
      onWait: () => report("busy", "knowledge_cycle_admission_wait"),
    });
    try {
      if (healthState !== "running") report("running", null);
      return await runAutonomousKnowledgeWorker({ ...input, signal });
    } finally {
      await admission.release();
    }
  };
  const runOnce = async () => {
    previous ??= await readResidentCycleState(root);
    if (woken && previous !== null) previous = { ...previous, idleStreak: 0 };
    woken = false;
    const cycle = await runResidentCycle({
      previous,
      now: Date.now,
      ceilingMilliseconds: ceiling,
      observe: () =>
        convergenceSourceFingerprint({ repositoryRoot: root, events: input.storage.events }),
      runFull,
    });
    if (cycle.outcome.kind === "skipped") {
      const state =
        cycle.state.lastResult === "waiting"
          ? "waiting"
          : cycle.state.lastResult === "attention"
            ? "attention"
            : "idle";
      report(
        state,
        state !== "idle" && healthState === state && healthReason !== null
          ? healthReason
          : "source_unchanged",
      );
    } else if (cycle.outcome.kind === "completed") {
      const { result } = cycle.outcome;
      report(healthOf(result), result.status === "processed" ? result.convergence.reason : null);
      input.onCycle?.(result);
    } else {
      report("attention", "knowledge_resident_cycle_failed");
      if (!signal.aborted) input.onFailure(cycle.outcome.error);
    }
    const now = Date.now();
    const delay = residentReconcileDelay({
      idleStreak: cycle.state.idleStreak,
      now,
      earliestAvailableAt: cycle.earliestAvailableAt,
      baseMilliseconds: base,
      ceilingMilliseconds: ceiling,
    });
    previous = { ...cycle.state, nextReconcileAt: new Date(now + delay).toISOString() };
    // The file is a rebuildable projection; losing it costs one full cycle after a restart.
    await writeResidentCycleState(root, previous).catch(() => undefined);
    return delay;
  };
  const cycle = () => {
    if (signal.aborted) return;
    if (running !== null) {
      pending = true;
      return;
    }
    if (reconcile !== null) clearTimeout(reconcile);
    reconcile = null;
    let delay = base;
    running = runOnce()
      .then((next) => {
        delay = next;
      })
      .catch((error) => {
        if (!signal.aborted) input.onFailure(error);
      })
      .finally(() => {
        running = null;
        if (signal.aborted) return;
        if (pending) {
          pending = false;
          schedule();
        }
        reconcile = setTimeout(cycle, delay);
      });
  };
  const schedule = () => {
    const now = Date.now();
    woken = true;
    firstWake ??= now;
    lastWake = now;
    if (debounce !== null) clearTimeout(debounce);
    const delay = Math.max(0, Math.min(lastWake + 30_000, firstWake + 60_000) - now);
    debounce = setTimeout(() => {
      debounce = null;
      firstWake = null;
      lastWake = null;
      cycle();
    }, delay);
  };
  const unsubscribe = input.subscribe
    ? input.subscribe(schedule)
    : watchProjectEventChanges(
        { path: input.storage.paths.eventDatabase, latest: () => input.storage.events.latest() },
        schedule,
      );
  const healthTimer = setInterval(heartbeat, 15_000);
  cycle();
  return async () => {
    controller.abort();
    if (reconcile !== null) clearTimeout(reconcile);
    clearInterval(healthTimer);
    if (debounce !== null) clearTimeout(debounce);
    unsubscribe?.();
    await running;
    if (reconcile !== null) clearTimeout(reconcile);
    healthState = "stopped";
    heartbeat();
    await healthWrite;
  };
}
