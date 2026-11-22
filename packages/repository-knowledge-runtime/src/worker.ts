import { readRepositoryHold } from "@lervo/repository-registry";
import { compactProjectConvergenceArtifacts } from "./cas-retention.js";
import { checkoutOnBaseBranch } from "./checkout-base-branch.js";
import { keepConvergenceDelegationHostLocal } from "./delegation-tracking.js";
import { admittedBackgroundContext } from "./background-provider.js";
import { runPracticeLearningCycle } from "./practice-stage.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  processKnowledgeConvergence,
  processRepositoryKnowledgeJobs,
  requeueStalledRepositoryKnowledgeJobs,
  withProcessCostScope,
  type KnowledgeConvergenceStatus,
  type RepositoryKnowledgeJobOutcome,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { createChangeReviewHost } from "./change-review-host.js";
import {
  assertConvergenceSourceCurrent,
  assertConvergenceSourceExact,
  createConvergenceRuntimeHost,
} from "./host.js";
import { knowledgeProviderAdmissionState } from "./provider-admission.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceSourceObservation } from "./source-observation.js";
import { convergenceRecoveryStatus } from "./recovery-status.js";
import { runDocumentFreshnessCycle, type DocumentFreshnessCycleResult } from "./freshness-stage.js";
import { documentFreshnessMayRun } from "./freshness-convergence-gate.js";
import type { InstructionCandidateExchangeTransport } from "./instruction-candidate-exchange.js";
import { exchangeInstructionCandidates } from "./instruction-candidate-exchange.js";
import { runNonOwnerCycle } from "./non-owner-cycle.js";
import {
  runOwnerTurnCaptureWork,
  type OwnerTurnCaptureWorkResult,
} from "./owner-turn-capture-work.js";
import { materializationTransactionState } from "./materialization-transaction.js";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { inspectConvergenceDebt } from "./status.js";
import {
  readMaintenanceObservation,
  recordMaintenanceObservation,
} from "./maintenance-observation.js";
import { reserveFreshnessPreparation } from "./maintenance-schedule.js";

/** A live materialization owns the repository; the cycle yields like a held worker lock. */
const MATERIALIZATION_BUSY = Symbol("materialization_busy");
/** ADR-0574: an upgrade waits for the host's full-cycle admission; the cycle stopped between stages. */
const YIELDED_TO_UPGRADE = Symbol("yielded_to_upgrade");
import { compactConvergenceWorkforce } from "./workforce-retention.js";
import { compactConvergenceWorkspaces } from "./workspace-retention.js";

async function changeReviewDeferred(context: ConvergenceRuntimeContext): Promise<boolean> {
  if (await context.liveWorkPending()) return true;
  let selected;
  try {
    selected = await admittedBackgroundContext(context);
  } catch (error) {
    if (
      [
        "provider_not_admitted",
        "knowledge_provider_paused",
        "knowledge_capacity_unavailable",
        "knowledge_authority_unavailable",
      ].includes((error as { code: string }).code)
    )
      return true;
    throw error;
  }
  return (
    await knowledgeProviderAdmissionState({
      provider: selected.provider,
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
   * ADR-0574: an upgrade waits for the host's full-cycle admission. Asked before each stage of
   * the cycle; each stage finishes its own durable writes first, and the rest stays due.
   * ADR-0587: a convergence, freshness, or change-review provider call in flight is abandoned.
   */
  yieldToUpgrade?: () => Promise<boolean>;
  /**
   * ADR-0466 cross-host owner gate. When present, a non-owner runs only its host-local duties
   * (ADR-0597); when absent, the legacy single-host behavior applies.
   */
  owner?: () => Promise<ConvergenceOwnerVerdict>;
  /** ADR-0467 Hub adapter for exchanging owner-rule candidates; absent keeps them host-local. */
  instructionCandidateTransport?: InstructionCandidateExchangeTransport;
  /**
   * ADR-0545, ADR-0561: applies every stored owner-rule candidate. It runs only on the convergence
   * owner, after capture and the Hub exchange; absent leaves candidates stored.
   */
  applyOwnerStatedInstructions?: () => Promise<unknown>;
  /** How convergence observes repository sources; absent, every observation is a full capture. */
  sourceObservation?: ConvergenceSourceObservation;
}): Promise<
  | {
      status: "busy";
      reason?:
        "knowledge_cycle_yielded_to_upgrade" | "repository_owner_hold" | "repository_not_on_base";
    }
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
  // ADR-0561: the owner's repository hold stops every effect of the resident here. Nothing is
  // lost: queued owner turns and pending stages stay due until the owner releases the hold.
  if ((await readRepositoryHold(root)) !== null)
    return { status: "busy", reason: "repository_owner_hold" };
  // Transcript evidence is host-local observation; it requires no provider call or convergence authority.
  await withProcessCostScope("terminal_skills", () =>
    withRepositoryKnowledgeWorkerLock(root, async () => {
      // Keep resident parsing lazy: hooks import the package's observation-only queue exports.
      const { runTerminalSkillObservationCycle } = await import("./terminal-skill-stage.js");
      return runTerminalSkillObservationCycle({ storage: input.storage, now: new Date() });
    }),
  ).catch(() => {});
  // ADR-0610: every later stage can write or commit in this checkout, so off the base branch the
  // cycle stops here and the owner's feature-branch or detached work never receives Lervo bytes.
  // Nothing is lost: pending stages and owner turns stay due until the checkout is back on base.
  if (!(await checkoutOnBaseBranch(root)).onBase)
    return { status: "busy", reason: "repository_not_on_base" };
  // ADR-0610: an older repository still tracks its host-local delegation; untrack it once.
  await keepConvergenceDelegationHostLocal(root).catch(() => undefined);
  const signal = input.signal ?? new AbortController().signal;
  const liveWorkPending =
    input.liveWorkPending ??
    (async () => hasCurrentForegroundLease(await listAssignments(root), Date.now()));
  await withProcessCostScope("artifact_retention", () =>
    compactProjectConvergenceArtifacts(
      input.storage,
      async () =>
        signal.aborted || (await liveWorkPending()) || ((await input.shouldYield?.()) ?? false),
    ),
  ).catch(() => undefined);
  const providerQuantum = {
    remaining: input.maximumProviderCallsPerTurn ?? Number.MAX_SAFE_INTEGER,
  };
  const practiceContext = {
    providerQuantum,
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal,
    liveWorkPending,
    now: () => new Date(),
  };
  const ownerTurnWork = () =>
    withProcessCostScope("owner_turns", () =>
      runOwnerTurnCaptureWork({
        storage: input.storage,
        provider: input.provider,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(input.admissionDirectory === undefined
          ? {}
          : { admissionDirectory: input.admissionDirectory }),
        signal,
        providerQuantum,
        liveWorkPending,
        ...(input.instructionCandidateTransport === undefined
          ? {}
          : { transport: input.instructionCandidateTransport }),
      }),
    );
  const upgradeWaiting = async () => (await input.yieldToUpgrade?.()) ?? false;
  const yieldedToUpgrade = {
    status: "busy",
    reason: "knowledge_cycle_yielded_to_upgrade",
  } as const;
  const owner = input.owner === undefined ? null : await input.owner();
  const transport = input.instructionCandidateTransport;
  if (owner !== null && owner.role !== "owner")
    return runNonOwnerCycle({
      storage: input.storage,
      owner,
      captureOwnerTurns: ownerTurnWork,
      observePractice: () => runPracticeLearningCycle(practiceContext, "observe"),
      ...(transport === undefined
        ? {}
        : {
            exchangeCandidates: () =>
              exchangeInstructionCandidates({
                storage: input.storage,
                transport,
                now: () => new Date(),
              }),
          }),
      upgradeWaiting,
    });
  const upgradePreemption =
    input.yieldToUpgrade === undefined ? {} : { yieldToUpgrade: input.yieldToUpgrade };
  const context: ConvergenceRuntimeContext = {
    ...upgradePreemption,
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal,
    liveWorkPending,
    ...(input.sourceObservation === undefined
      ? {}
      : { sourceObservation: input.sourceObservation }),
    assertSourceExact: (state) => assertConvergenceSourceExact(context, state),
    assertSourceCurrent: (state) => assertConvergenceSourceCurrent(context, state),
    providerQuantum,
  };
  const freshnessContext = {
    ...upgradePreemption,
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
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    if (await reserveFreshnessPreparation(root)) {
      const prepared = await withProcessCostScope("freshness_prepare", () =>
        runDocumentFreshnessCycle({
          context: freshnessContext,
          effects: "prepare",
          maximumCandidates: 1,
        }),
      );
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
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    await withProcessCostScope("retention", async () => {
      await compactConvergenceWorkspaces(input.storage);
      await compactConvergenceWorkforce(input.storage);
      await requeueStalledRepositoryKnowledgeJobs({
        repositoryRoot: root,
        events: input.storage.events,
      });
    });
    // Owner-turn capture (ADR-0467) runs first: it is small, bounded per cycle, and its result is
    // what the next prompt shows. Its failure leaves the queue for a later cycle and blocks nothing.
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    const ownerTurns = await ownerTurnWork();
    // ADR-0545: the owner stated these rules, so no review command waits on the owner or an agent.
    // A failure leaves every candidate stored for the next cycle and blocks nothing.
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    await withProcessCostScope("owner_rules", async () =>
      input.applyOwnerStatedInstructions?.(),
    ).catch(() => undefined);
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    await withProcessCostScope("practice", () =>
      runPracticeLearningCycle(practiceContext, "write"),
    );
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    // Live work or a paused provider leaves change jobs queued instead of spending their attempts.
    const outcomes = await withProcessCostScope("change_review", async () =>
      (await changeReviewDeferred(context))
        ? []
        : processRepositoryKnowledgeJobs({
            repositoryRoot: root,
            events: input.storage.events,
            artifacts: input.storage.artifacts,
            workerId: input.workerId,
            maximumJobs: 1,
            host: createChangeReviewHost(context),
          }),
    );
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    const delegation = await loadConvergenceDelegation(root);
    let convergence: KnowledgeConvergenceStatus;
    try {
      convergence = await withProcessCostScope("convergence", () =>
        processKnowledgeConvergence({
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
        }),
      );
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
    if (await upgradeWaiting()) return YIELDED_TO_UPGRADE;
    const freshness: DocumentFreshnessCycleResult = documentFreshnessMayRun(convergence)
      ? await withProcessCostScope("freshness", () =>
          runDocumentFreshnessCycle({ context: freshnessContext }),
        ).catch((): DocumentFreshnessCycleResult => ({ status: "unavailable" }))
      : { status: "yielded" };
    return { outcomes, convergence, freshness, ownerTurns };
  });
  if (result.status === "busy" || result.result === MATERIALIZATION_BUSY) return { status: "busy" };
  if (result.result === YIELDED_TO_UPGRADE) return yieldedToUpgrade;
  await recordMaintenanceObservation({
    root,
    projectId: input.storage.manifest.projectId,
    status: result.result.convergence,
    owner,
    source: "worker",
  });
  return { status: "processed", ...result.result };
}
