import { measureProcessCost, withProcessCostScope } from "@lervo/repository-knowledge";
import { holdProcessPresence } from "@lervo/project-storage";
import { readRepositoryHold } from "@lervo/repository-registry";
import { residentContinuityTurns } from "./resident-continuity-turns.js";
import { convergenceEvaluationContract } from "./evaluation-contract.js";
import { runAutonomousKnowledgeWorker } from "./worker.js";
import { coalescedRefresh } from "./resident-projection-refresh.js";
import { residentCycleHealth } from "./resident-cycle-health.js";
import { recordKnowledgeResidentHealth, type KnowledgeResidentState } from "./resident-health.js";
import { acquireFullCycleAdmission } from "./full-cycle-admission.js";
import { convergenceSourceFingerprint } from "./source-fingerprint.js";
import { residentWakeOffset } from "./resident-wake-offset.js";
import {
  readResidentCycleState,
  writeResidentCycleState,
  type ResidentCycleState,
} from "./resident-cycle-state.js";
import {
  residentCadence,
  residentNextCycleAt,
  residentReconcileDelay,
  runResidentCycle,
} from "./resident-cycle.js";
import {
  RESIDENT_PROJECTION_MAXIMUM_AGE_MILLISECONDS,
  residentProjectionRefresher,
} from "./resident-projection-fence.js";
import { residentDeadlines } from "./resident-deadlines.js";
import { wireResidentWakes } from "./resident-wakes.js";
import { residentCycleTrigger } from "./resident-cycle-trigger.js";
import type { AutonomousKnowledgeWorkerInput } from "./loop-options.js";
import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import {
  ownershipFingerprint,
  evaluationFingerprint,
  hubTokenFingerprint,
  RESIDENT_OWNER_HEARTBEAT_MILLISECONDS,
} from "./resident-ownership.js";

/**
 * The standalone host needs no Hub. Startup, event and repository wakeups, and an adaptive
 * reconciliation timer share one owner; an unchanged change fence skips the full cycle.
 */
export function startAutonomousKnowledgeWorker(
  input: AutonomousKnowledgeWorkerInput,
): () => Promise<void> {
  const { base, ceiling } = residentCadence(input);
  const root = input.storage.paths.repositoryRoot;
  const wakeOffset = residentWakeOffset(input.storage.manifest.projectId);
  const controller = new AbortController();
  const signal =
    input.signal === undefined
      ? controller.signal
      : AbortSignal.any([input.signal, controller.signal]);
  let woken = false;
  let previous: ResidentCycleState | null | undefined;
  let failureStreak = 0;
  let healthState: KnowledgeResidentState = "idle";
  let healthReason: string | null = null;
  let healthWrite = Promise.resolve();
  let verdict: ConvergenceOwnerVerdict | null = null;
  // Aborts an in-flight full cycle when an observation proves this host no longer owns convergence.
  let ownedCycle: AbortController | null = null;
  // ADR-0602: readers probe this presence, so health is written only when it changes.
  const presence = holdProcessPresence();
  let written: string | null = null;
  let healthFailures = 0;
  let healthRetry: NodeJS.Timeout | null = null;
  const writeHealth = () => {
    const key = `${healthState}\0${healthReason ?? ""}`;
    if (key === written) return;
    written = key;
    healthWrite = healthWrite
      .then(() => presence.ready)
      .then(() =>
        recordKnowledgeResidentHealth({
          repositoryRoot: root,
          workerId: input.workerId,
          state: healthState,
          reason: healthReason,
          presence: presence.token,
        }),
      )
      .then(
        () => {
          healthFailures = 0;
        },
        (error: unknown) => {
          written = null;
          input.onFailure(error);
          // ADR-0602: nothing rewrites an unchanged state, so a lost write retries with backoff.
          if (signal.aborted || healthRetry !== null) return;
          healthFailures = Math.min(healthFailures + 1, 64);
          healthRetry = setTimeout(
            () => {
              healthRetry = null;
              if (!signal.aborted) writeHealth();
            },
            Math.min(15 * 60_000, 1_000 * 2 ** (healthFailures - 1)),
          );
          healthRetry.unref();
        },
      );
  };
  const report = (state: KnowledgeResidentState, reason: string | null) => {
    healthState = state;
    healthReason = reason;
    writeHealth();
  };
  const deadlines = residentDeadlines(
    {
      reconcile: () => cycle(),
      continuity: () => void continuityTurns.run(),
      // Renewal only; a lost lease aborts the running cycle and the next cycle reports it.
      owner: () => {
        if (verdict?.role === "owner") observeOwnership().catch(input.onFailure);
      },
      // During a cycle only the age bound applies; the cycle's own offer follows its changes.
      projection: () => void offerProjection({ ageOnly: trigger.running() !== null }),
    },
    (name) => input.onFailure(new Error(`The resident's ${name} deadline came back in the past.`)),
  );
  // The observation in flight, so a fence event its own write caused compares with its verdict.
  let observing: Promise<unknown> = Promise.resolve();
  const observeOwnership = async () => {
    if (input.ownership === undefined) return null;
    const observation = input.ownership.observe(signal);
    observing = observation.catch(() => undefined);
    verdict = await observation;
    if (verdict.role !== "owner") ownedCycle?.abort();
    // ADR-0602: on a Hub that keeps a present holder's lease live, the owner renews only while a
    // cycle runs, so its commit fence stays valid; while its Hub wait is down, or on an earlier
    // Hub, it renews as before.
    const renews = verdict.role === "owner" && (trigger.running() !== null || !wakes.hubPushing());
    deadlines.set(
      "owner",
      renews
        ? Date.now() + (input.ownerHeartbeatMilliseconds ?? RESIDENT_OWNER_HEARTBEAT_MILLISECONDS)
        : null,
    );
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
  // One reconciliation at a time, whether its deadline or the cycle asks for it.
  const continuityTurns = residentContinuityTurns({
    continuity: input.continuity,
    signal,
    held: repositoryHeld,
    cycleRunning: () => trigger.running() !== null,
    onDue: (at) => deadlines.set("continuity", at),
    onFailure: input.onFailure,
  });
  // ADR-0602: a Hub change can carry peer records or definitions, so the next turn reconciles.
  let continuityForced = false;
  const reconcileContinuity = () => {
    const force = continuityForced;
    continuityForced = false;
    return continuityTurns.run({ force });
  };
  // One refresh at a time; the cycle's own refresh and this cadence share the same single flight.
  const projection = coalescedRefresh(input.refreshHealth, signal, input.onFailure);
  let held = false;
  const refresher = residentProjectionRefresher({
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
  const offerProjection = async (options: { ageOnly?: boolean } = {}) => {
    await refresher(options);
    deadlines.set("projection", refresher.nextDueAt(options));
  };
  const refreshProjection = () => offerProjection();
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
        observe: () =>
          withProcessCostScope("fingerprint", () =>
            evaluationFingerprint(
              ownershipFingerprint(
                hubTokenFingerprint(
                  convergenceSourceFingerprint({
                    repositoryRoot: root,
                    events: input.storage.events,
                    wakeOffsetMilliseconds: wakeOffset,
                    owner: observedOwner === null || observedOwner.role === "owner",
                  }),
                  wakes.hubToken(),
                ),
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
    const at = residentNextCycleAt({
      now,
      cycle,
      unverifiable: observedOwner?.role === "unverifiable",
      publicationRetryAfterMs:
        publication?.status === "published" ? publication.retryAfterMs : null,
      baseMilliseconds: base,
      ceilingMilliseconds: ceiling,
    });
    previous = {
      ...cycle.state,
      lastObservedAt: new Date(cycle.observedAt).toISOString(),
      // ADR-0602: none when only a change can give it work.
      nextReconcileAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    };
    // The file is a rebuildable projection; losing it costs one full cycle after a restart.
    await writeResidentCycleState(root, previous).catch(() => undefined);
    return at;
  };
  // One cycle; ADR-0602: Infinity clears the deadline, so only a change or a due time wakes it.
  const runCycle = async () => {
    deadlines.set("reconcile", null);
    let at: number;
    try {
      at = await runOnce();
      failureStreak = 0;
    } catch (error) {
      if (!signal.aborted) input.onFailure(error);
      report("attention", "knowledge_resident_cycle_failed");
      // ADR-0595: a cycle that keeps failing backs off like an idle one instead of retrying at the
      // base cadence; a wakeup or a successful cycle resets the streak.
      failureStreak = Math.min(failureStreak + 1, 64);
      at =
        Date.now() +
        residentReconcileDelay({
          idleStreak: failureStreak,
          now: Date.now(),
          earliestAvailableAt: null,
          baseMilliseconds: base,
          ceilingMilliseconds: ceiling,
        });
      await healthWrite;
      await refreshProjection();
    }
    if (!signal.aborted) deadlines.set("reconcile", at);
    // A continuity turn that met this cycle's own lock runs once the cycle has fully ended.
    setImmediate(() => continuityTurns.afterCycle());
  };
  const trigger = residentCycleTrigger({
    signal,
    debounceMilliseconds: input.wakeDebounceMilliseconds ?? 30_000,
    run: runCycle,
    onWake: () => {
      woken = true;
      failureStreak = 0;
    },
  });
  const cycle = trigger.cycle;
  const ownsQueue = () => verdict === null || verdict.role === "owner";
  const wakes = wireResidentWakes({
    storage: input.storage,
    ...(input.subscribe === undefined ? {} : { subscribe: input.subscribe }),
    ownsQueue,
    projection: input.refreshHealth !== undefined,
    hubChanges: input.hubChanges,
    onChange: trigger.schedule,
    // A projection input written by another process offers a refresh at once.
    onProjectionInput: () => {
      if (trigger.running() === null) void offerProjection();
    },
    // A release wakes a held resident like an event.
    onHoldStore: () => {
      // A change during a cycle is re-checked after it, since the cycle read the hold already.
      if (trigger.running() !== null) {
        trigger.again();
        return;
      }
      if (held)
        repositoryHeld().then((still) => {
          if (!still && held && !signal.aborted) {
            held = false;
            trigger.schedule();
          }
        }, input.onFailure);
    },
    // ADR-0602: a release command in another process rewrites this checkout's fence; the
    // resident's own observations write the verdict it already holds and are ignored.
    onOwnerFence: () => {
      observing
        .then(() => readConvergenceOwnerFence(root))
        .then((fence) => {
          const written = fence?.verdict ?? null;
          if (written === null || signal.aborted) return;
          if (written.observedAt === verdict?.observedAt && written.role === verdict.role) return;
          if (trigger.running() !== null) observeOwnership().catch(input.onFailure);
          trigger.wakeNow();
        }, input.onFailure);
    },
    onHubChange: () => {
      continuityForced = true;
      trigger.wakeNow();
    },
    // ADR-0602: a host policy, owner-host or provider pause change reconciles at once.
    continuityInputs: input.continuity?.inputPaths() ?? [],
    onContinuityInput: () => void continuityTurns.run(),
  });
  writeHealth();
  deadlines.set("projection", refresher.nextDueAt());
  // ADR-0602: the first cycle folds the Hub token in when it arrives in time, so a restart does
  // not run one full cycle without it and another with it.
  void wakes.ready().then(() => cycle());
  return async () => {
    controller.abort();
    deadlines.stop();
    trigger.stop();
    await wakes.stop();
    await trigger.running();
    await projection.running();
    await continuityTurns.settled();
    deadlines.stop();
    if (healthRetry !== null) clearTimeout(healthRetry);
    healthState = "stopped";
    writeHealth();
    await healthWrite;
    presence.release();
  };
}
