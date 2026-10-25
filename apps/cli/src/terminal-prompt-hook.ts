import { openProjectStorage } from "@lervo/project-storage";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import { writeTerminalActivationReceipt } from "./terminal-activation-state.js";
import {
  newTerminalIdentifier,
  TERMINAL_OBSERVATION_POLICY_VERSION,
} from "./terminal-event-coordinates.js";
import { queueTerminalOwnerTurn } from "./terminal-instruction-capture.js";
import { prepareTerminalPromptContext } from "./terminal-prompt-context.js";
import { withinTerminalDeadline } from "./terminal-hook-budget.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { recordPreparedTerminalContext } from "./terminal-turn-observation.js";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-contract.js";
import type { CliServices } from "./types.js";

export async function prepareAndRecordTerminalPrompt({
  root,
  prompt,
  providerSessionId,
  provider,
  observationId,
  workspaceBinding,
  timing,
  coordinates,
  contractId,
  occurredAt,
  deadlineMs,
  services,
}: {
  root: string;
  prompt: string;
  providerSessionId: string;
  provider: TerminalIntegrationProvider;
  observationId: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  timing: TerminalStageObservationPort;
  coordinates: UnmanagedTerminalCoordinates;
  contractId: "lervo_terminal_hooks_v1" | "lervo_terminal_hooks_v2";
  occurredAt: string;
  deadlineMs: number;
  services: Pick<CliServices, "projectSearchQueries">;
}): Promise<string> {
  const context = await timing.measure("context_assembly", () =>
    prepareTerminalPromptContext({
      root,
      prompt: prompt,
      provider,
      workspaceBinding,
      timing,
      observationId,
      services,
    }),
  );
  const observationEventId = newTerminalIdentifier("evt");
  const observationStorage = await timing.measure("event_commit", () => openProjectStorage(root));
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
        hookEvent: "UserPromptSubmit",
        result: "context_prepared",
        occurredAt,
        queryDigest: sha256(prompt),
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
        providerSessionId: providerSessionId,
        prompt: prompt,
        workspaceBinding,
        now: new Date(occurredAt),
      }),
    );
    await recordTerminalStageObservation({
      root,
      coordinates,
      observationId,
      hookEvent: "UserPromptSubmit",
      timing,
      outcome: "completed",
      policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
      storage: observationStorage,
    });
  } finally {
    await withinTerminalDeadline(deadlineMs, () => observationStorage.close());
  }
  return context.additionalContext;
}
