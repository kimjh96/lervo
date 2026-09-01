import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import { writeTerminalActivationReceipt } from "./terminal-activation-state.js";
import {
  newTerminalIdentifier,
  TERMINAL_OBSERVATION_POLICY_VERSION,
  unmanagedTerminalCoordinates,
} from "./terminal-event-coordinates.js";
import type {
  ParsedTerminalHookInput,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { prepareTerminalPromptContext } from "./terminal-prompt-context.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import {
  preparedTerminalTurnExpectation,
  recordObservedTerminalTurn,
  recordPreparedTerminalContext,
} from "./terminal-turn-observation.js";
import {
  attachTerminalWorkspace,
  checkpointTerminalWorkspace,
  TerminalWorkspaceIsolationError,
  type TerminalWorkspaceBinding,
} from "./terminal-workspace-lifecycle.js";
import type { CliIo, CliServices } from "./types.js";

function parseHookInput(value: string): ParsedTerminalHookInput {
  if (Buffer.byteLength(value) > 256 * 1024)
    throw new Error("Hook input exceeds the bounded input limit.");
  const parsed = JSON.parse(value) as {
    hook_event_name?: unknown;
    session_id?: unknown;
    turn_id?: unknown;
    prompt?: unknown;
    stop_hook_active?: unknown;
    last_assistant_message?: unknown;
  };
  if (parsed?.hook_event_name !== "UserPromptSubmit" && parsed?.hook_event_name !== "Stop")
    throw new Error("Unsupported provider hook event.");
  if (
    typeof parsed.session_id !== "string" ||
    parsed.session_id.trim() === "" ||
    parsed.session_id.length > 512
  )
    throw new Error("The provider session coordinate is missing or invalid.");
  if (
    parsed.turn_id !== undefined &&
    (typeof parsed.turn_id !== "string" ||
      parsed.turn_id.trim() === "" ||
      parsed.turn_id.length > 512)
  )
    throw new Error("The provider turn coordinate is invalid.");
  if (
    parsed.hook_event_name === "UserPromptSubmit" &&
    (typeof parsed.prompt !== "string" ||
      parsed.prompt.trim() === "" ||
      parsed.prompt.length > 64 * 1024)
  )
    throw new Error("The prompt is missing or exceeds the bounded prompt limit.");
  if (
    parsed.hook_event_name === "Stop" &&
    parsed.stop_hook_active !== undefined &&
    typeof parsed.stop_hook_active !== "boolean"
  )
    throw new Error("The provider Stop continuation state is invalid.");
  if (
    parsed.hook_event_name === "Stop" &&
    parsed.last_assistant_message !== undefined &&
    parsed.last_assistant_message !== null &&
    typeof parsed.last_assistant_message !== "string"
  )
    throw new Error("The provider completion message is invalid.");
  return {
    event: parsed.hook_event_name,
    providerSessionId: parsed.session_id,
    providerTurnId: typeof parsed.turn_id === "string" ? parsed.turn_id : null,
    stopHookActive: parsed.stop_hook_active === true,
    ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {}),
    ...(parsed.last_assistant_message === null || typeof parsed.last_assistant_message === "string"
      ? { lastAssistantMessage: parsed.last_assistant_message }
      : {}),
  };
}

export async function runTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation" | "projectSearchQueries">,
): Promise<number> {
  const timing = services.createTerminalStageObservation(TERMINAL_OBSERVATION_POLICY_VERSION);
  try {
    const { provider, contractId, input } = await timing.measure("ingress_integrity", async () => {
      const parsed = parseArgs({
        args,
        strict: true,
        allowPositionals: false,
        options: { provider: { type: "string" }, contract: { type: "string" } },
      });
      if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
        throw new Error("--provider must be codex or claude.");
      const provider: TerminalIntegrationProvider = parsed.values.provider;
      if (parsed.values.contract !== "1" && parsed.values.contract !== "2")
        throw new Error("Unsupported terminal integration contract.");
      if (io.stdin === undefined) throw new Error("Provider hook input is unavailable.");
      return {
        provider,
        contractId:
          parsed.values.contract === "2"
            ? ("lervo_terminal_hooks_v2" as const)
            : ("lervo_terminal_hooks_v1" as const),
        input: parseHookInput(await io.stdin()),
      };
    });
    if (input.event === "Stop" && input.stopHookActive) {
      io.stdout("{}\n");
      return 0;
    }
    let stageContext: {
      root: string;
      coordinates: UnmanagedTerminalCoordinates;
      observationId: string;
    } | null = null;
    try {
      const root = await timing.measure("repository_discovery", () =>
        resolveTerminalRepositoryRoot(io.cwd),
      );
      const coordinates = unmanagedTerminalCoordinates(provider, input);
      const occurredAt = new Date().toISOString();
      if (input.event === "UserPromptSubmit") {
        const observationId = newTerminalIdentifier("tobs");
        stageContext = { root, coordinates, observationId };
        let workspaceBinding: TerminalWorkspaceBinding | null;
        try {
          workspaceBinding = await timing.measure("lifecycle_inspection", () =>
            attachTerminalWorkspace({
              root,
              provider,
              providerSessionId: input.providerSessionId,
              now: new Date(occurredAt),
            }),
          );
        } catch (error) {
          if (!(error instanceof TerminalWorkspaceIsolationError)) throw error;
          await recordTerminalStageObservation({
            root,
            coordinates,
            observationId,
            hookEvent: input.event,
            timing,
            outcome: "completed",
            policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
          });
          io.stdout(
            `${JSON.stringify({
              decision: "block",
              reason: `Lervo blocked terminal workspace attachment.\n${error.code}: run lervo workspace inspect --json and recover only this assignment workspace.`,
            })}\n`,
          );
          return 0;
        }
        const context = await prepareTerminalPromptContext({
          root,
          prompt: input.prompt!,
          provider,
          observationId,
          workspaceBinding,
          services,
          timing,
        });
        const observationEventId = newTerminalIdentifier("evt");
        const observationStorage = await openProjectStorage(root);
        try {
          await timing.measure("event_commit", async () => {
            await recordPreparedTerminalContext({
              root,
              provider,
              coordinates,
              observationId,
              context,
              workspaceBinding,
              occurredAt,
              eventId: observationEventId,
              storage: observationStorage,
            });
            await writeTerminalActivationReceipt(root, {
              schemaVersion: 1,
              contractId,
              provider,
              hookEvent: input.event,
              result: "context_prepared",
              occurredAt,
              queryDigest: sha256(input.prompt!),
              queryProjectionReceiptId: context.grounding.queryProjectionReceipt.receiptId,
              sourceSnapshotId: context.sourceSnapshotId,
              recommendationCount: context.recommendationCount,
              loadedDocumentCount: context.documents.length,
              contextHash: sha256(context.additionalContext),
              repositoryRevision: context.repositoryRevision,
              observationEventId,
            });
          });
          await recordTerminalStageObservation({
            root,
            coordinates,
            observationId,
            hookEvent: input.event,
            timing,
            outcome: "completed",
            policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
            storage: observationStorage,
          });
        } finally {
          await observationStorage.close();
        }
        io.stdout(
          `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.additionalContext } })}\n`,
        );
        return 0;
      }
      const expectation = await timing.measure("lifecycle_inspection", () =>
        preparedTerminalTurnExpectation(root, coordinates, provider, input.providerSessionId),
      );
      if (expectation === null) {
        io.stdout("{}\n");
        return 0;
      }
      stageContext = { root, coordinates, observationId: expectation.observationId };
      const lifecycle = await timing.measure("lifecycle_inspection", () =>
        inspectTerminalLifecycle(root, expectation),
      );
      let workspaceCheckpointEventId: string | null = null;
      if (
        lifecycle.status === "current" &&
        expectation.workspaceBinding?.executionKind === "worker" &&
        lifecycle.workspace !== null
      ) {
        try {
          workspaceCheckpointEventId = (
            await timing.measure("event_commit", () =>
              checkpointTerminalWorkspace({
                root,
                inspection: lifecycle.workspace!,
                contextEventId: expectation.contextEventId,
                occurredAt: expectation.preparedAt,
              }),
            )
          ).eventId;
        } catch {
          lifecycle.issues.push({
            code: "workspace_checkpoint_failed",
            command: "lervo workspace inspect --json",
          });
          lifecycle.status = "action_required";
        }
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
        policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
      });
      io.stdout("{}\n");
      return 0;
    } catch {
      if (stageContext !== null) {
        await recordTerminalStageObservation({
          ...stageContext,
          hookEvent: input.event,
          timing,
          outcome: "failed",
          policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
        }).catch(() => undefined);
      }
      io.stdout("{}\n");
      return 0;
    }
  } catch {
    io.stderr(
      "Lervo terminal integration failed closed without exposing prompt or provider configuration content.\n",
    );
    return 2;
  }
}
