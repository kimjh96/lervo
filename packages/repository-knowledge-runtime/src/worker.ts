import { loadConvergenceDelegation } from "./delegation.js";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  processKnowledgeConvergence,
  processRepositoryKnowledgeJobs,
  requeueStalledRepositoryKnowledgeJobs,
  type KnowledgeConvergenceStatus,
  type RepositoryKnowledgeJobOutcome,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { createChangeReviewHost } from "./change-review-host.js";
import { createConvergenceRuntimeHost, assertConvergenceSource } from "./host.js";
import { knowledgeProviderAdmissionState } from "./provider-admission.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceRecoveryStatus } from "./recovery-status.js";
import { runDocumentFreshnessCycle, type DocumentFreshnessCycleResult } from "./freshness-stage.js";
import { documentFreshnessMayRun } from "./freshness-convergence-gate.js";
import type { InstructionCandidateExchangeTransport } from "./instruction-candidate-exchange.js";
import { listQueuedInstructionCaptures } from "./instruction-capture-queue.js";
import {
  runOwnerTurnCaptureWork,
  type OwnerTurnCaptureWorkResult,
} from "./owner-turn-capture-work.js";
import { materializationTransactionState } from "./materialization-transaction.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { inspectConvergenceDebt } from "./status.js";
import { recordMaintenanceObservation } from "./maintenance-observation.js";
import { reserveFreshnessPreparation } from "./maintenance-schedule.js";
import { readMaintenanceObservation } from "./maintenance-observation.js";

/** A live materialization owns the repository; the cycle yields like a held worker lock. */
const MATERIALIZATION_BUSY = Symbol("materialization_busy");
import { compactConvergenceWorkforce } from "./workforce-retention.js";
import {
  compactConvergenceWorkspaces,
  hasConvergenceWorkspaceRetention,
} from "./workspace-retention.js";

async function changeReviewDeferred(context: ConvergenceRuntimeContext): Promise<boolean> {
  if (await context.liveWorkPending()) return true;
  return (
    await knowledgeProviderAdmissionState({
      provider: context.provider,
      ...(context.admissionDirectory === undefined
        ? {}
        : { directory: context.admissionDirectory }),
    })
  ).paused;
}

/** Startup, idle timer, event wakeups and detached CLI calls compose this same owner. */
export async function runAutonomousKnowledgeWorker(input: {
  storage: ProjectStorage;
  workerId: string;
  provider: "codex" | "claude";
  executable?: string;
  signal?: AbortSignal;
  maximumStages?: number;
  /** Residents yield after one provider call; explicit one-shot workers retain their stage ceiling. */
  maximumProviderCallsPerTurn?: number;
  admissionDirectory?: string;
  liveWorkPending?: () => Promise<boolean>;
  /** ADR-0485: another repository waits for the host's full-cycle admission; yield between stages. */
  shouldYield?: () => Promise<boolean>;
  /**
   * ADR-0466 cross-host owner gate. When present, a non-owner runs only read-only debt detection;
   * when absent, the legacy single-host behavior applies.
   */
  owner?: () => Promise<ConvergenceOwnerVerdict>;
  /** ADR-0467 Hub adapter for exchanging owner-rule candidates; absent keeps them host-local. */
  instructionCandidateTransport?: InstructionCandidateExchangeTransport;
}): Promise<
  | { status: "busy" }
  | {
      status: "waiting_owner";
      owner: ConvergenceOwnerVerdict;
      convergence: KnowledgeConvergenceStatus;
      /** Owner-turn work runs on every host; null when there was nothing to do or the lock was held. */
      ownerTurns: OwnerTurnCaptureWorkResult | null;
    }
  | {
      status: "processed";
      outcomes: RepositoryKnowledgeJobOutcome[];
      convergence: KnowledgeConvergenceStatus;
      freshness?: DocumentFreshnessCycleResult;
      ownerTurns?: OwnerTurnCaptureWorkResult;
    }
> {
  const root = input.storage.paths.repositoryRoot;
  // Transcript evidence is host-local observation; it requires no provider call or convergence authority.
  await withRepositoryKnowledgeWorkerLock(root, async () => {
    // Keep resident parsing lazy: hooks import the package's observation-only queue exports.
    const { runTerminalSkillObservationCycle } = await import("./terminal-skill-stage.js");
    return runTerminalSkillObservationCycle({ storage: input.storage, now: new Date() });
  }).catch(() => {});
  const signal = input.signal ?? new AbortController().signal;
  const liveWorkPending =
    input.liveWorkPending ??
    (async () => hasCurrentForegroundLease(await listAssignments(root), Date.now()));
  const ownerTurnWork = () =>
    runOwnerTurnCaptureWork({
      storage: input.storage,
      provider: input.provider,
      ...(input.executable === undefined ? {} : { executable: input.executable }),
      ...(input.admissionDirectory === undefined
        ? {}
        : { admissionDirectory: input.admissionDirectory }),
      signal,
      liveWorkPending,
      ...(input.instructionCandidateTransport === undefined
        ? {}
        : { transport: input.instructionCandidateTransport }),
    });
  const owner = input.owner === undefined ? null : await input.owner();
  if (owner !== null && owner.role !== "owner") {
    // ADR-0467: assessing this host's own owner turns is not convergence work, so it runs here too.
    // A non-owner with no queued turn and no Hub exchange has nothing to do and takes no lock.
    const pending =
      input.instructionCandidateTransport !== undefined ||
      (await listQueuedInstructionCaptures(root).catch(() => [])).length > 0;
    const ownerTurns = pending
      ? await withRepositoryKnowledgeWorkerLock(root, ownerTurnWork)
      : null;
    // ADR-0518: convergence checkouts are host-local, so a non-owner still retires its own.
    if (await hasConvergenceWorkspaceRetention(input.storage))
      await withRepositoryKnowledgeWorkerLock(root, () =>
        compactConvergenceWorkspaces(input.storage),
      );
    const inspected = await inspectConvergenceDebt(input.storage);
    await recordMaintenanceObservation({
      root,
      projectId: input.storage.manifest.projectId,
      status: inspected.status,
      baselineCurrent: inspected.baselineCurrent,
      owner,
      source: "inspection",
    });
    return {
      status: "waiting_owner",
      owner,
      convergence: inspected.status,
      ownerTurns: ownerTurns === null || ownerTurns.status === "busy" ? null : ownerTurns.result,
    };
  }
  const context: ConvergenceRuntimeContext = {
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal,
    liveWorkPending,
    assertSource: (state) => assertConvergenceSource(context, state),
    providerQuantum: { remaining: input.maximumProviderCallsPerTurn ?? Number.MAX_SAFE_INTEGER },
  };
  const freshnessContext = {
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal: context.signal,
    liveWorkPending: context.liveWorkPending,
    now: () => new Date(),
    providerQuantum: context.providerQuantum!,
  };
  const result = await withRepositoryKnowledgeWorkerLock(root, async () => {
    const turnStartedAt = Date.now();
    const transaction = await materializationTransactionState(root);
    if (transaction === "busy") return MATERIALIZATION_BUSY;
    if (transaction === "recovery_required")
      return { outcomes: [], convergence: convergenceRecoveryStatus(input.storage) };
    if (await reserveFreshnessPreparation(root)) {
      const prepared = await runDocumentFreshnessCycle({
        context: freshnessContext,
        effects: "prepare",
        maximumCandidates: 1,
      });
      if (
        prepared.status === "completed" &&
        (context.providerQuantum!.remaining <= 0 ||
          prepared.candidateCount > 0 ||
          prepared.verifiedCount > 0 ||
          prepared.deferred !== null)
      ) {
        const observed = await readMaintenanceObservation(root, input.storage.manifest.projectId);
        return {
          outcomes: [],
          convergence: observed?.status ?? (await inspectConvergenceDebt(input.storage)).status,
          freshness: prepared,
        };
      }
    }
    await compactConvergenceWorkspaces(input.storage);
    await compactConvergenceWorkforce(input.storage);
    await requeueStalledRepositoryKnowledgeJobs({
      repositoryRoot: root,
      events: input.storage.events,
    });
    // Owner-turn capture (ADR-0467) runs first: it is small, bounded per cycle, and its result is
    // what the next prompt shows. Its failure leaves the queue for a later cycle and blocks nothing.
    const ownerTurns = await ownerTurnWork();
    // Live work or a paused provider leaves change jobs queued instead of spending their attempts.
    const outcomes = (await changeReviewDeferred(context))
      ? []
      : await processRepositoryKnowledgeJobs({
          repositoryRoot: root,
          events: input.storage.events,
          artifacts: input.storage.artifacts,
          workerId: input.workerId,
          maximumJobs: 1,
          host: createChangeReviewHost(context),
        });
    const delegation = await loadConvergenceDelegation(root);
    let convergence: KnowledgeConvergenceStatus;
    try {
      convergence = await processKnowledgeConvergence({
        events: input.storage.events,
        artifacts: input.storage.artifacts,
        workerId: input.workerId,
        writableEventSchemaVersion: input.storage.writableEventSchemaVersion ?? 1,
        host: createConvergenceRuntimeHost(context),
        maximumStages: Math.min(
          input.maximumStages ?? 8,
          delegation?.delegation.resourceCeilings.maximumStages ?? 8,
        ),
        shouldYield: async () =>
          context.providerQuantum!.remaining <= 0 ||
          Date.now() - turnStartedAt >= 30_000 ||
          ((await input.shouldYield?.()) ?? false),
      });
    } catch (error) {
      // Another process's transaction can begin while discovery reads knowledge currency.
      if ((error as { code?: unknown } | null)?.code !== "knowledge_recovery_required") throw error;
      if ((await materializationTransactionState(root)) === "recovery_required")
        return {
          outcomes,
          convergence: convergenceRecoveryStatus(input.storage),
          ownerTurns,
        };
      return MATERIALIZATION_BUSY;
    }
    // Freshness runs after intake and convergence (ADR-0463) and only while convergence is parked,
    // so its commit never lands inside an ADR-0465 batch boundary; its failure never blocks them.
    const freshness: DocumentFreshnessCycleResult = documentFreshnessMayRun(convergence)
      ? await runDocumentFreshnessCycle({
          context: freshnessContext,
        }).catch((): DocumentFreshnessCycleResult => ({ status: "unavailable" }))
      : { status: "yielded" };
    return { outcomes, convergence, freshness, ownerTurns };
  });
  if (result.status === "busy" || result.result === MATERIALIZATION_BUSY) return { status: "busy" };
  await recordMaintenanceObservation({
    root,
    projectId: input.storage.manifest.projectId,
    status: result.result.convergence,
    owner,
    source: "worker",
  });
  return { status: "processed", ...result.result };
}
