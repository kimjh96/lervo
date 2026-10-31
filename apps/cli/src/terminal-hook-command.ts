import { hostOutcomeTask, observeHostContextOutcomes } from "@lervo/repository-context";
import { terminalTranscriptPosition } from "@lervo/repository-knowledge-runtime";
import { parseArgs } from "node:util";

import { launchDetachedKnowledgeWorker } from "./detached-knowledge-worker.js";
import { terminalWorkerEntry } from "./terminal-worker-entry.js";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import { writeTerminalActivationReceipt } from "./terminal-activation-state.js";
import {
  newTerminalIdentifier,
  TERMINAL_HOOK_BUILD_DIGEST,
  TERMINAL_OBSERVATION_POLICY_VERSION,
  unmanagedTerminalCoordinates,
} from "./terminal-event-coordinates.js";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import { parseTerminalHookInput } from "./terminal-hook-input.js";
import { queueTerminalOwnerTurn, settleTerminalAgentTurn } from "./terminal-instruction-capture.js";
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
  pauseTerminalWorkspace,
  TerminalWorkspaceIsolationError,
  type TerminalWorkspaceBinding,
} from "./terminal-workspace-lifecycle.js";
import type { CliIo, CliServices } from "./types.js";

export async function runTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation" | "projectSearchQueries">,
): Promise<number> {
  const timing = services.createTerminalStageObservation(TERMINAL_HOOK_BUILD_DIGEST);
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
        input: parseTerminalHookInput(await io.stdin()),
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
        const transcript = await terminalTranscriptPosition(provider, input.transcriptPath);
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
              transcript,
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
              preparationQuality: context.preparationQuality,
              recommendationCount: context.recommendationCount,
              loadedDocumentCount: context.documents.length,
              contextHash: sha256(context.additionalContext),
              repositoryRevision: context.repositoryRevision,
              observationEventId,
            });
          });
          // ADR-0467: queue the owner's turn for background semantic capture. A queue failure
          // loses only this capture; it never blocks or delays the prompt.
          await timing.measure("event_commit", () =>
            queueTerminalOwnerTurn({
              root,
              provider,
              providerSessionId: input.providerSessionId,
              prompt: input.prompt!,
              workspaceBinding,
              now: new Date(occurredAt),
            }).catch(() => false),
          );
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
          const checkpoint = await timing.measure("event_commit", () =>
            checkpointTerminalWorkspace({
              root,
              inspection: lifecycle.workspace!,
              contextEventId: expectation.contextEventId,
              occurredAt,
            }),
          );
          workspaceCheckpointEventId = checkpoint.eventId;
          await timing.measure("event_commit", () =>
            pauseTerminalWorkspace({
              root,
              inspection: lifecycle.workspace!,
              checkpoint,
              occurredAt,
            }),
          );
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
      await observeHostContextOutcomes({
        repositoryRoot: root,
        origin: "terminal",
        effects: "read_only",
        coordinates,
        task: hostOutcomeTask(
          "Inspect observed terminal outputs; original task acceptance is unavailable.",
          observation.changedPaths,
        ),
        artifacts: observation.changedPaths.map((path) => ({ kind: "repository" as const, path })),
      });
      await timing.measure("event_commit", () =>
        settleTerminalAgentTurn({
          root,
          provider,
          providerSessionId: input.providerSessionId,
          lastAssistantMessage: input.lastAssistantMessage,
          workspaceBinding: expectation.workspaceBinding,
          now: new Date(occurredAt),
        }).catch(() => ({ capturePending: false })),
      );
      const hookRuntime = process.env.LERVO_TERMINAL_HOOK_RUNTIME;
      const workerEntry = await terminalWorkerEntry(root);
      if (workerEntry !== null && workerEntry !== undefined)
        launchDetachedKnowledgeWorker({
          root,
          entry: workerEntry,
          args: ["knowledge", "worker", "--once", "--provider", provider],
        });
      // Prepare the next compact prompt's knowledge snapshot after this turn's final bytes.
      if (hookRuntime !== undefined && process.env.LERVO_TERMINAL_CONTEXT !== "retrieval")
        launchDetachedKnowledgeWorker({ root, entry: hookRuntime, args: ["prefetch-context"] });
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
