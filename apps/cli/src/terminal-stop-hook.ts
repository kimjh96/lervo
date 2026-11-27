import { hostOutcomeTask, observeHostContextOutcomes } from "@lervo/repository-context";
import { recordTurnGovernance } from "./turn-governance.js";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { TerminalHookFailureReason } from "@lervo/schemas";
import type {
  ParsedTerminalHookInput,
  PreparedTerminalTurnExpectation,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { CliIo } from "./types.js";
import { writeTerminalActivationReceipt } from "./terminal-activation-state.js";
import { launchDetachedKnowledgeWorker } from "./detached-knowledge-worker.js";
import { terminalWorkerEntry } from "./terminal-worker-entry.js";
import { withinTerminalDeadline } from "./terminal-hook-budget.js";
import { TERMINAL_OBSERVATION_POLICY_VERSION } from "./terminal-event-coordinates.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { REPOSITORY_REPLICA_SERVICE_INSPECTION_FAILED } from "./terminal-repository-replica-service-inspection.js";
import { settleTerminalAgentTurn } from "./terminal-instruction-capture.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { recordObservedTerminalTurn } from "./terminal-turn-observation.js";
import {
  checkpointTerminalWorkspace,
  pauseTerminalWorkspace,
} from "./terminal-workspace-lifecycle.js";
import { launchTerminalTurnSettlements } from "./terminal-turn-settlement-lease.js";
import { stopAnswer } from "./terminal-stop-answer.js";

/**
 * Knowledge inspections own every `*_inspection_failed` code except the replica service's, which
 * is a host lifecycle check; it keeps its own issue code and degrades the turn as a lifecycle
 * failure, never as skipped knowledge checks.
 */
function lifecycleFailureReason(
  issues: Array<{ code: string }>,
): TerminalHookFailureReason | undefined {
  if (
    issues.some(
      (issue) =>
        issue.code.endsWith("_inspection_failed") &&
        issue.code !== REPOSITORY_REPLICA_SERVICE_INSPECTION_FAILED,
    )
  )
    return "knowledge_inspection_failed";
  return issues.some(
    (issue) =>
      issue.code === REPOSITORY_REPLICA_SERVICE_INSPECTION_FAILED ||
      issue.code === "workstream_state_invalid",
  )
    ? "lifecycle_inspection_failed"
    : undefined;
}

export async function completeTerminalHookTurn({
  root,
  executionRoot = root,
  coordinates,
  input,
  provider,
  contractId,
  occurredAt,
  expectation,
  timing,
  io,
  onRepositoryCaptured,
  conversationBlockReason,
}: {
  /** The repository the turn's evidence, queues, and shared state belong to. */
  root: string;
  /** The checkout the session works in; a linked worktree differs from `root`. */
  executionRoot?: string;
  coordinates: UnmanagedTerminalCoordinates;
  input: ParsedTerminalHookInput;
  provider: TerminalIntegrationProvider;
  contractId: "lervo_terminal_hooks_v1" | "lervo_terminal_hooks_v2";
  occurredAt: string;
  expectation: PreparedTerminalTurnExpectation;
  timing: TerminalStageObservationPort;
  io: CliIo;
  /** ADR-0636: called once the turn's repository is captured; a served Stop may answer then. */
  onRepositoryCaptured?: () => void;
  /** A conversation's reconciliation found conflicts: the `Stop` blocks once with this reason. */
  conversationBlockReason?: string | null;
}): Promise<number> {
  const lifecycle = await timing.measure("lifecycle_inspection", () =>
    inspectTerminalLifecycle(root, expectation, undefined, executionRoot, onRepositoryCaptured),
  );
  let failureReason: TerminalHookFailureReason | undefined = lifecycleFailureReason(
    lifecycle.issues,
  );
  let workspaceCheckpointEventId: string | null = null;
  if (
    lifecycle.status === "current" &&
    expectation.workspaceBinding?.executionKind === "worker" &&
    lifecycle.workspace !== null
  ) {
    await timing.measure("event_commit", async () => {
      try {
        const checkpoint = await checkpointTerminalWorkspace({
          root,
          inspection: lifecycle.workspace!,
          contextEventId: expectation.contextEventId,
          occurredAt,
        });
        workspaceCheckpointEventId = checkpoint.eventId;
        await pauseTerminalWorkspace({
          root,
          inspection: lifecycle.workspace!,
          checkpoint,
          occurredAt,
        });
      } catch {
        lifecycle.issues.push({
          code: "workspace_checkpoint_failed",
          command: "lervo workspace inspect --json",
        });
        lifecycle.status = "action_required";
        failureReason ??= "event_persistence_failed";
      }
    });
  }
  const observation = await timing.measure("event_commit", () =>
    recordObservedTerminalTurn({
      root,
      executionRoot,
      provider,
      coordinates,
      hookInput: input,
      lifecycle,
      workspaceCheckpointEventId,
      occurredAt,
    }),
  );
  // ADR-0552: canon naming a changed path that the turn did not consult is shown next turn. A
  // failure loses only this observation.
  await timing.measure("lifecycle_inspection", () =>
    recordTurnGovernance({
      root,
      turnKey: expectation.contextEventId,
      changedPaths: observation.changedPaths,
      selectedPaths: observation.consultedPaths,
      at: occurredAt,
    }).catch(() => undefined),
  );
  await timing.measure("lifecycle_inspection", () =>
    // Outcomes read the changed files, so they observe the checkout. A linked worktree's own store
    // selects no writer, so its outcomes stay unobserved until they can record into `root`.
    observeHostContextOutcomes({
      repositoryRoot: executionRoot,
      origin: "terminal",
      effects: "read_only",
      coordinates,
      task: hostOutcomeTask(
        "Inspect observed terminal outputs; original task acceptance is unavailable.",
        observation.changedPaths,
      ),
      artifacts: observation.changedPaths.map((path) => ({ kind: "repository" as const, path })),
    }),
  );
  await timing.measure("event_commit", () =>
    settleTerminalAgentTurn({
      root,
      provider,
      providerSessionId: input.providerSessionId,
      lastAssistantMessage: input.lastAssistantMessage,
      workspaceBinding: expectation.workspaceBinding,
      now: new Date(occurredAt),
    }).catch(() => {
      failureReason ??= "event_persistence_failed";
      return { capturePending: false };
    }),
  );
  const hookRuntime = process.env.LERVO_TERMINAL_HOOK_RUNTIME;
  // ADR-0542: background work runs in the bound full CLI, never in the hook runtime. Without a
  // current binding nothing starts; the host resident's next cycle does the same work.
  const workerEntry = await terminalWorkerEntry(root).catch(() => null);
  if (workerEntry !== null)
    await withinTerminalDeadline(timing.observationDeadlineMs ?? performance.now() + 1000, () =>
      launchDetachedKnowledgeWorker({
        root,
        entry: workerEntry,
        args: ["knowledge", "worker", "--once", "--provider", provider],
      }),
    ).catch(() => false);
  // Prepare the next compact prompt's knowledge snapshot after this turn's final bytes.
  if (hookRuntime !== undefined)
    await withinTerminalDeadline(timing.observationDeadlineMs ?? performance.now() + 1000, () =>
      launchDetachedKnowledgeWorker({
        root: executionRoot,
        entry: hookRuntime,
        args: ["prefetch-context"],
      }),
    ).catch(() => false);
  // A turn an earlier worker never settled: the session's next hook picks it up.
  await withinTerminalDeadline(timing.observationDeadlineMs ?? performance.now() + 1000, () =>
    launchTerminalTurnSettlements(root, executionRoot),
  ).catch(() => false);
  const blockReason =
    expectation.workspaceBinding?.executionKind === "worker" &&
    lifecycle.status === "action_required"
      ? workerBlockReason(lifecycle.issues)
      : (conversationBlockReason ?? null);
  await timing.measure("event_commit", () =>
    writeTerminalActivationReceipt(root, {
      schemaVersion: 1,
      contractId,
      provider,
      hookEvent: input.event,
      result: blockReason === null ? "completion_allowed" : "completion_blocked",
      occurredAt,
      observationEventId: observation.eventId,
      referenceCount: observation.referenceCount,
      selectedCount: observation.selectedCount,
      pathMentionCount: observation.pathMentionCount,
    }),
  );
  await recordTerminalStageObservation({
    root,
    coordinates,
    observationId: expectation.observationId,
    hookEvent: input.event,
    timing,
    outcome: "completed",
    ...(failureReason === undefined ? {} : { failureReason }),
    policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
  });
  io.stdout(stopAnswer(blockReason));
  return 0;
}

/** Why a worker may not finish: its workspace isolation boundary is not current. */
function workerBlockReason(
  issues: Array<{ code: string; detail?: string; command: string }>,
): string {
  return [
    "Lervo blocked worker completion because this workspace isolation boundary is not current.",
    ...issues.map(
      (item) =>
        `${item.code}: ${item.detail === undefined ? "" : `${item.detail}; `}run ${item.command}, review the read-only plan, and apply the exact current plan with --apply; Lervo cross-checks it first.`,
    ),
    "Recover only this assignment workspace, then try to finish again; do not advance another workspace's global lifecycle.",
  ].join("\n");
}
