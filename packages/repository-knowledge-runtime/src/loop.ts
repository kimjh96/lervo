import type { ProjectStorage } from "@lervo/project-storage";
import {
  measureProcessCost,
  withProcessCostScope,
  type ProcessCostMeasurement,
} from "@lervo/repository-knowledge";
import { readRepositoryHold } from "@lervo/repository-registry";
import { convergenceEvaluationContract } from "./evaluation-contract.js";
import { runAutonomousKnowledgeWorker } from "./worker.js";
import { coalescedRefresh } from "./resident-projection-refresh.js";
import { residentCycleHealth } from "./resident-cycle-health.js";
import {
  RESIDENT_HEALTH_HEARTBEAT_MILLISECONDS,
  recordKnowledgeResidentHealth,
  type KnowledgeResidentState,
} from "./resident-health.js";
import { acquireFullCycleAdmission } from "./full-cycle-admission.js";
import { convergenceSourceFingerprint } from "./source-fingerprint.js";
import { residentWakeOffset } from "./resident-wake-offset.js";
import { watchResidentEventChanges } from "./resident-event-wakeup.js";
import {
  readResidentCycleState,
  writeResidentCycleState,
  type ResidentCycleState,
} from "./resident-cycle-state.js";
import { residentCadence, residentReconcileDelay, runResidentCycle } from "./resident-cycle.js";
import {
  RESIDENT_PROJECTION_CHECK_MILLISECONDS,
  RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS,
  residentProjectionRefresher,
} from "./resident-projection-fence.js";
import type { ConvergenceOwnership } from "./convergence-owner.js";
import type { ConvergenceContinuity } from "./convergence-continuity.js";
import type { InstructionCandidateExchangeTransport } from "./instruction-candidate-exchange.js";
import type { KnowledgePublicationOutcome } from "./knowledge-publication.js";
import type { KnowledgePublicationRepairEvents } from "./knowledge-publication-repair.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import {
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
/** ADR-0595: a held resident backs off, so it checks this often whether the owner released it. */
export const RESIDENT_HOLD_RELEASE_CHECK_MILLISECONDS = 60_000;
/**
 * ADR-0595: how often the resident checks whether the health projection's inputs changed. A
 * refresh runs only on a change, or after `RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS` unchanged.
 */
export const RESIDENT_HEALTH_REFRESH_MILLISECONDS = RESIDENT_PROJECTION_CHECK_MILLISECONDS;

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
   * Read-only projections, offered after every observation (including skipped and failed cycles)
   * and on their own check cadence, so a long cycle never leaves the projection older than its
   * display window. ADR-0595: an offer refreshes only when the projection's inputs changed, or
   * after the maximum age while nothing changed; a held repository has no age refresh.
   */
  refreshHealth?: () => Promise<void>;
  healthRefreshMilliseconds?: number;
  projectionMaximumAgeMilliseconds?: number;
  /** ADR-0595: the longest an unchanged fingerprint may skip the full cycle. */
  forcedFullCycleMilliseconds?: number;
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
  holdReleaseCheckMilliseconds?: number;
}): () => Promise<void> {
  const { base, ceiling, forcedFullCycle } = residentCadence(input);
  const root = input.storage.paths.repositoryRoot;
  const wakeOffset = residentWakeOffset(input.storage.manifest.projectId);
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
  let failureStreak = 0;
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
  let held = false;
  const refreshProjection = residentProjectionRefresher({
    repositoryRoot: root,
    events: input.storage.events,
    enabled: input.refreshHealth !== undefined,
    signal,
    refresh: projection.refresh,
    residentState: () => `${healthState}\0${healthReason ?? ""}`,
    held: () => held,
    maximumAgeMilliseconds:
      input.projectionMaximumAgeMilliseconds ?? RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS,
  });
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
        // ADR-0597: the forced cycle is spread like the day boundary, so residents never align.
        ceilingMilliseconds: forcedFullCycle + wakeOffset,
        observe: () =>
          withProcessCostScope("fingerprint", () =>
            evaluationFingerprint(
              ownershipFingerprint(
                convergenceSourceFingerprint({
                  repositoryRoot: root,
                  events: input.storage.events,
                  wakeOffsetMilliseconds: wakeOffset,
                  owner: observedOwner === null || observedOwner.role === "owner",
                }),
                observedOwner,
              ),
              convergenceEvaluationContract(),
            ),
          ),
        runFull,
      }),
    );
    held = cycle.state.lastResult === "held";
    const health = residentCycleHealth(cycle, { state: healthState, reason: healthReason });
    report(health.state, health.reason);
    if (cycle.outcome.kind === "completed") input.onCycle?.(cycle.outcome.result, cost);
    else if (cycle.outcome.kind === "failed" && !signal.aborted)
      input.onFailure(cycle.outcome.error);
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
        failureStreak = 0;
      })
      .catch(async (error) => {
        if (!signal.aborted) input.onFailure(error);
        report("attention", "knowledge_resident_cycle_failed");
        // ADR-0595: a cycle that keeps failing backs off like an idle one instead of retrying at
        // the base cadence; a wakeup or a successful cycle resets the streak.
        failureStreak = Math.min(failureStreak + 1, 64);
        delay = residentReconcileDelay({
          idleStreak: failureStreak,
          now: Date.now(),
          earliestAvailableAt: null,
          baseMilliseconds: base,
          ceilingMilliseconds: ceiling,
        });
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
    failureStreak = 0;
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
    : watchResidentEventChanges(input.storage, schedule);
  const healthTimer = setInterval(heartbeat, RESIDENT_HEALTH_HEARTBEAT_MILLISECONDS);
  const projectionTimer =
    input.refreshHealth === undefined
      ? null
      : setInterval(
          // During a cycle only the age bound applies; the cycle's own offer follows its changes.
          () => void refreshProjection({ ageOnly: running !== null }),
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
  // A release wakes the resident like an event, so it never waits out its held backoff.
  const holdReleaseTimer = setInterval(() => {
    if (held && running === null)
      repositoryHeld().then((still) => {
        if (!still && held && !signal.aborted) {
          held = false;
          schedule();
        }
      }, input.onFailure);
  }, input.holdReleaseCheckMilliseconds ?? RESIDENT_HOLD_RELEASE_CHECK_MILLISECONDS);
  cycle();
  return async () => {
    controller.abort();
    if (reconcile !== null) clearTimeout(reconcile);
    clearInterval(healthTimer);
    if (projectionTimer !== null) clearInterval(projectionTimer);
    if (continuityTimer !== null) clearInterval(continuityTimer);
    clearInterval(holdReleaseTimer);
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
