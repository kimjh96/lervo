import { hostOutcomeTask, observeHostContextOutcomes } from "@lervo/repository-context";
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
import { launchDetachedKnowledgeWorker } from "./knowledge-worker-launch.js";
import { withinTerminalDeadline } from "./terminal-hook-budget.js";
import { TERMINAL_OBSERVATION_POLICY_VERSION } from "./terminal-event-coordinates.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { settleTerminalAgentTurn } from "./terminal-instruction-capture.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { recordObservedTerminalTurn } from "./terminal-turn-observation.js";
import {
  checkpointTerminalWorkspace,
  pauseTerminalWorkspace,
} from "./terminal-workspace-lifecycle.js";

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
  let failureReason: TerminalHookFailureReason | undefined = lifecycle.issues.some((issue) =>
    issue.code.endsWith("_inspection_failed"),
  )
    ? "knowledge_inspection_failed"
    : lifecycle.issues.some((issue) => issue.code === "workstream_state_invalid")
      ? "lifecycle_inspection_failed"
      : undefined;
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
  const capture = await timing.measure("event_commit", () =>
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
  if ((observation.knowledgeJobQueued || capture.capturePending) && hookRuntime !== undefined)
    await withinTerminalDeadline(timing.observationDeadlineMs ?? performance.now() + 1000, () =>
      launchDetachedKnowledgeWorker({
        root,
        entry: hookRuntime,
        args: ["knowledge-worker", "--provider", provider],
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
