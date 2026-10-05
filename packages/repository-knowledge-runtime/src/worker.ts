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
import { materializationTransactionState } from "./materialization-transaction.js";

/** A live materialization owns the repository; the cycle yields like a held worker lock. */
const MATERIALIZATION_BUSY = Symbol("materialization_busy");
import { compactConvergenceWorkforce } from "./workforce-retention.js";
import { compactConvergenceWorkspaces } from "./workspace-retention.js";

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
  admissionDirectory?: string;
  liveWorkPending?: () => Promise<boolean>;
}): Promise<
  | { status: "busy" }
  | {
      status: "processed";
      outcomes: RepositoryKnowledgeJobOutcome[];
      convergence: KnowledgeConvergenceStatus;
    }
> {
  const root = input.storage.paths.repositoryRoot;
  const context: ConvergenceRuntimeContext = {
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal: input.signal ?? new AbortController().signal,
    liveWorkPending:
      input.liveWorkPending ??
      (async () => hasCurrentForegroundLease(await listAssignments(root), Date.now())),
    assertSource: (state) => assertConvergenceSource(context, state),
  };
  const result = await withRepositoryKnowledgeWorkerLock(root, async () => {
    const transaction = await materializationTransactionState(root);
    if (transaction === "busy") return MATERIALIZATION_BUSY;
    if (transaction === "recovery_required")
      return { outcomes: [], convergence: convergenceRecoveryStatus(input.storage) };
    await compactConvergenceWorkspaces(input.storage, input.provider);
    await compactConvergenceWorkforce(input.storage);
    await requeueStalledRepositoryKnowledgeJobs({
      repositoryRoot: root,
      events: input.storage.events,
    });
    // Live work or a paused provider leaves change jobs queued instead of spending their attempts.
    const outcomes = (await changeReviewDeferred(context))
      ? []
      : await processRepositoryKnowledgeJobs({
          repositoryRoot: root,
          events: input.storage.events,
          artifacts: input.storage.artifacts,
          workerId: input.workerId,
          maximumJobs: 8,
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
      });
    } catch (error) {
      // Another process's transaction can begin while discovery reads knowledge currency.
      if ((error as { code?: unknown } | null)?.code !== "knowledge_recovery_required") throw error;
      if ((await materializationTransactionState(root)) === "recovery_required")
        return { outcomes, convergence: convergenceRecoveryStatus(input.storage) };
      return MATERIALIZATION_BUSY;
    }
    return { outcomes, convergence };
  });
  if (result.status === "busy" || result.result === MATERIALIZATION_BUSY) return { status: "busy" };
  return { status: "processed", ...result.result };
}
