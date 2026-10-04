import { loadConvergenceDelegation } from "./delegation.js";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  processKnowledgeConvergence,
  processRepositoryKnowledgeJobs,
  inspectRepositoryKnowledgeCurrency,
  assertNoKnowledgeMaterializationTransaction,
  type KnowledgeConvergenceStatus,
  type RepositoryKnowledgeJobOutcome,
} from "@lervo/repository-knowledge";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import { createConvergenceRuntimeHost, assertConvergenceSource } from "./host.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceRecoveryStatus } from "./recovery-status.js";
import { compactConvergenceWorkforce } from "./workforce-retention.js";
import { compactConvergenceWorkspaces } from "./workspace-retention.js";

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
    try {
      await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
    } catch (error) {
      if ((error as { code?: string }).code !== "knowledge_recovery_required") throw error;
      return { outcomes: [], convergence: convergenceRecoveryStatus(input.storage) };
    }
    await compactConvergenceWorkspaces(input.storage, input.provider);
    await compactConvergenceWorkforce(input.storage);
    // Legacy work is adopted as explicit attention evidence. V4 semantic work belongs to scoped assignments.
    const outcomes = await processRepositoryKnowledgeJobs({
      repositoryRoot: root,
      events: input.storage.events,
      artifacts: input.storage.artifacts,
      workerId: input.workerId,
      maximumJobs: 8,
      host: {
        review: async () => ({ classification: "needs_review" }),
        inspectKnowledge: () => inspectRepositoryKnowledgeCurrency(root),
      },
    });
    const delegation = await loadConvergenceDelegation(root);
    const convergence = await processKnowledgeConvergence({
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
    return { outcomes, convergence };
  });
  return result.status === "busy" ? result : { status: "processed", ...result.result };
}
