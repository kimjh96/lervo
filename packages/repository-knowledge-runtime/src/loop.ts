import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";
import {
  measureProcessCost,
  withProcessCostScope,
  type ProcessCostMeasurement,
} from "@lervo/repository-knowledge";
import { readRepositoryHold } from "@lervo/repository-registry";
import { convergenceEvaluationContract } from "./evaluation-contract.js";
import { runAutonomousKnowledgeWorker } from "./worker.js";
import { coalescedRefresh } from "./resident-projection-refresh.js";
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
import type { ConvergenceOwnership } from "./convergence-owner.js";
import type { ConvergenceContinuity } from "./convergence-continuity.js";
import type { InstructionCandidateExchangeTransport } from "./instruction-candidate-exchange.js";
import type { KnowledgePublicationOutcome } from "./knowledge-publication.js";
import type { KnowledgePublicationRepairEvents } from "./knowledge-publication-repair.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import {
  nonOwnerHealth,
  ownershipFingerprint,
  evaluationFingerprint,
  RESIDENT_OWNER_HEARTBEAT_MILLISECONDS,
} from "./resident-ownership.js";

type WorkerResult = Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;

/**
 * ADR-0470: continuity (including owner-host derivation, which decides whether this host may own
 * at all) is offered a turn on this timer as well as before each cycle, so a cycle waiting for
 * host-wide full-cycle admission cannot starve it. Reconciliation is rate-limited internally.
 */
export const RESIDENT_CONTINUITY_TICK_MILLISECONDS = 60_000;
/** Under the 20-minute display window of the health projection (ADR-0535). */
export const RESIDENT_HEALTH_REFRESH_MILLISECONDS = 5 * 60_000;

function healthOf(result: WorkerResult): KnowledgeResidentState {
  if (result.status === "busy") return "busy";
  if (result.status === "waiting_owner") return nonOwnerHealth(result.owner).state;
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
  /** `cost` covers the fence observation and the full cycle, attributed by scope. */
  onCycle?: (result: WorkerResult, cost: ProcessCostMeasurement) => void;
  /**
   * Read-only projections run after every observation, including skipped and failed cycles, and
   * on their own cadence so a long cycle never leaves the projection older than its display window.
   */
  refreshHealth?: () => Promise<void>;
  healthRefreshMilliseconds?: number;
  onFailure: (error: unknown) => void;
  intervalMilliseconds?: number;
  reconcileCeilingMilliseconds?: number;
  /** ADR-0466 cross-host owner; absent keeps the legacy single-host resident. */
  ownership?: ConvergenceOwnership;
  ownerHeartbeatMilliseconds?: number;
  /**
   * Publishes the owner's settled commits after each cycle; absent disables publication. The
   * resident's event store receives `knowledge.publication.repaired` (ADR-0473).
   */
  publish?: (context: {
    events: KnowledgePublicationRepairEvents;
  }) => Promise<KnowledgePublicationOutcome>;
  /** ADR-0467 Hub adapter for owner-rule candidates; absent keeps them host-local. */
  instructionCandidateTransport?: InstructionCandidateExchangeTransport;
  /** ADR-0545 owner-stated rule application on the convergence owner; absent keeps candidates. */
  applyOwnerStatedInstructions?: () => Promise<unknown>;
  /** ADR-0469 delegation and host continuity; it runs before each ownership observation. */
  continuity?: ConvergenceContinuity;
  continuityTickMilliseconds?: number;
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
  let verdict: ConvergenceOwnerVerdict | null = null;
  // Aborts an in-flight full cycle when a heartbeat proves this host no longer owns convergence.
  let ownedCycle: AbortController | null = null;
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
  const observeOwnership = async () => {
    if (input.ownership === undefined) return null;
    verdict = await input.ownership.observe(signal);
    if (verdict.role !== "owner") ownedCycle?.abort();
    return verdict;
  };
  const runFull = async () => {
    report("running", null);
    const observed = verdict;
    const owned = new AbortController();
    ownedCycle = owned;
    const cycleSignal = AbortSignal.any([signal, owned.signal]);
    const admission = await acquireFullCycleAdmission({
      repositoryRoot: root,
      signal: cycleSignal,
      ...(input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory }),
      onWait: () => report("busy", "knowledge_cycle_admission_wait"),
    });
    try {
      if (healthState !== "running") report("running", null);
      return await runAutonomousKnowledgeWorker({
        ...input,
        maximumProviderCallsPerTurn: 1,
        shouldYield: () => admission.contended(),
        yieldToUpgrade: () => admission.preempted(),
        signal: cycleSignal,
        ...(observed === null ? {} : { owner: async () => observed }),
      });
    } finally {
      ownedCycle = null;
      await admission.release();
    }
  };
  // ADR-0561: while the owner holds the repository, the resident applies nothing there: the cycle
  // returns before any stage, and continuity and publication, which commit, push, and renew, wait.
  const repositoryHeld = async () => (await readRepositoryHold(root)) !== null;
  let continuityRun: Promise<void> | null = null;
  // One reconciliation at a time, whether the timer or the cycle asks for it.
  const reconcileContinuity = (): Promise<void> => {
    const continuity = input.continuity;
    if (continuity === undefined || signal.aborted) return Promise.resolve();
    continuityRun ??= repositoryHeld()
      .then(async (held) => {
        if (!held) await continuity.reconcile({ signal });
      })
      .then(
        () => undefined,
        (error: unknown) => {
          if (!signal.aborted) input.onFailure(error);
        },
      )
      .finally(() => {
        continuityRun = null;
      });
    return continuityRun;
  };
  // One refresh at a time; the cycle's own refresh and this cadence share the same single flight.
  const projection = coalescedRefresh(input.refreshHealth, signal, input.onFailure);
  const refreshProjection = projection.refresh;
  const runOnce = async () => {
    previous ??= await readResidentCycleState(root);
    if (woken && previous !== null) previous = { ...previous, idleStreak: 0 };
    woken = false;
    // Continuity is rate-limited internally and never blocks the cycle; its findings are state.
    await reconcileContinuity();
    const observedOwner = await observeOwnership();
    const observedPrevious = previous;
    const { value: cycle, cost } = await measureProcessCost(() =>
      runResidentCycle({
        repositoryRoot: root,
        previous: observedPrevious,
        now: Date.now,
        ceilingMilliseconds: ceiling,
        observe: () =>
          withProcessCostScope("fingerprint", () =>
            evaluationFingerprint(
              ownershipFingerprint(
                convergenceSourceFingerprint({
                  repositoryRoot: root,
                  events: input.storage.events,
                }),
                observedOwner,
              ),
              convergenceEvaluationContract(),
            ),
          ),
        runFull,
      }),
    );
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
      report(
        healthOf(result),
        result.status === "processed"
          ? result.convergence.reason
          : result.status === "waiting_owner"
            ? nonOwnerHealth(result.owner).reason
            : (result.reason ?? null),
      );
      input.onCycle?.(result, cost);
    } else {
      report("attention", "knowledge_resident_cycle_failed");
      if (!signal.aborted) input.onFailure(cycle.outcome.error);
    }
    // Publication follows the cycle so commits made by it go out at once; only an owner publishes.
    const publication =
      input.publish !== undefined &&
      verdict?.role === "owner" &&
      !signal.aborted &&
      !(await repositoryHeld())
        ? await input.publish({ events: input.storage }).catch((error: unknown) => {
            input.onFailure(error);
            return null;
          })
        : null;
    await healthWrite;
    await refreshProjection();
    const now = Date.now();
    const reconcileDelay = residentReconcileDelay({
      idleStreak: cycle.state.idleStreak,
      now,
      earliestAvailableAt: cycle.earliestAvailableAt,
      // Publication and projection refresh run in between, so a due time can pass meanwhile.
      observedAt: cycle.observedAt,
      baseMilliseconds: base,
      ceilingMilliseconds: ceiling,
    });
    const delay =
      publication?.status === "published" && publication.retryAfterMs !== null
        ? Math.min(reconcileDelay, publication.retryAfterMs)
        : reconcileDelay;
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
      .catch(async (error) => {
        if (!signal.aborted) input.onFailure(error);
        report("attention", "knowledge_resident_cycle_failed");
        await healthWrite;
        await refreshProjection();
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
  const projectionTimer =
    input.refreshHealth === undefined
      ? null
      : setInterval(
          () => void refreshProjection(),
          input.healthRefreshMilliseconds ?? RESIDENT_HEALTH_REFRESH_MILLISECONDS,
        );
  const ownerHeartbeat =
    input.ownership === undefined
      ? null
      : setInterval(() => {
          // Renewal only; a lost lease aborts the running cycle and the next cycle reports it.
          if (verdict?.role === "owner") observeOwnership().catch(input.onFailure);
        }, input.ownerHeartbeatMilliseconds ?? RESIDENT_OWNER_HEARTBEAT_MILLISECONDS);
  const continuityTimer =
    input.continuity === undefined
      ? null
      : setInterval(
          () => void reconcileContinuity(),
          input.continuityTickMilliseconds ?? RESIDENT_CONTINUITY_TICK_MILLISECONDS,
        );
  cycle();
  return async () => {
    controller.abort();
    if (reconcile !== null) clearTimeout(reconcile);
    clearInterval(healthTimer);
    if (projectionTimer !== null) clearInterval(projectionTimer);
    if (continuityTimer !== null) clearInterval(continuityTimer);
    if (ownerHeartbeat !== null) clearInterval(ownerHeartbeat);
    if (debounce !== null) clearTimeout(debounce);
    unsubscribe?.();
    await running;
    await projection.running();
    await continuityRun;
    if (reconcile !== null) clearTimeout(reconcile);
    healthState = "stopped";
    heartbeat();
    await healthWrite;
  };
}
