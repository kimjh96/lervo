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
  coordinates,
  input,
  provider,
  contractId,
  occurredAt,
  expectation,
  timing,
  io,
}: {
  root: string;
  coordinates: UnmanagedTerminalCoordinates;
  input: ParsedTerminalHookInput;
  provider: TerminalIntegrationProvider;
  contractId: "lervo_terminal_hooks_v1" | "lervo_terminal_hooks_v2";
  occurredAt: string;
  expectation: PreparedTerminalTurnExpectation;
  timing: TerminalStageObservationPort;
  io: CliIo;
}): Promise<number> {
  const lifecycle = await timing.measure("lifecycle_inspection", () =>
    inspectTerminalLifecycle(root, expectation),
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
    observeHostContextOutcomes({
      repositoryRoot: root,
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
  if (hookRuntime !== undefined && process.env.LERVO_TERMINAL_CONTEXT !== "retrieval")
    await withinTerminalDeadline(timing.observationDeadlineMs ?? performance.now() + 1000, () =>
      launchDetachedKnowledgeWorker({ root, entry: hookRuntime, args: ["prefetch-context"] }),
    ).catch(() => false);
  if (
    expectation.workspaceBinding?.executionKind === "worker" &&
    lifecycle.status === "action_required"
  ) {
    const reason = [
      "Lervo blocked worker completion because this workspace isolation boundary is not current.",
      ...lifecycle.issues.map(
        (item) =>
          `${item.code}: ${item.detail === undefined ? "" : `${item.detail}; `}run ${item.command}, review the read-only plan, and apply only the exact current plan/approval.`,
      ),
      "Recover only this assignment workspace, then try to finish again; do not advance another workspace's global lifecycle.",
    ].join("\n");
    await timing.measure("event_commit", () =>
      writeTerminalActivationReceipt(root, {
        schemaVersion: 1,
        contractId,
        provider,
        hookEvent: input.event,
        result: "completion_blocked",
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
    io.stdout(`${JSON.stringify({ decision: "block", reason })}\n`);
    return 0;
  }
  await timing.measure("event_commit", () =>
    writeTerminalActivationReceipt(root, {
      schemaVersion: 1,
      contractId,
      provider,
      hookEvent: input.event,
      result: "completion_allowed",
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
  io.stdout("{}\n");
  return 0;
}
