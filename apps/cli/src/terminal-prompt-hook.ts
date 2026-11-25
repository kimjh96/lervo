import { openProjectStorage } from "@lervo/project-storage";
import {
  absentTerminalTranscript,
  terminalTranscriptPosition,
} from "@lervo/repository-knowledge-runtime";
import { terminalKnowledgeBootstrapNotice } from "./knowledge-bootstrap.js";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import { writeTerminalActivationReceipt } from "./terminal-activation-state.js";
import {
  newTerminalIdentifier,
  TERMINAL_OBSERVATION_POLICY_VERSION,
} from "./terminal-event-coordinates.js";
import { queueTerminalOwnerTurn } from "./terminal-instruction-capture.js";
import {
  prepareTerminalPromptContext,
  type PreparedTerminalPromptContext,
} from "./terminal-prompt-context.js";
import { withinTerminalDeadline } from "./terminal-hook-budget.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { recordHealthStopAppearance } from "./repository-health-appearance.js";
import { convergenceStopLine } from "./repository-health-format.js";
import { writeLearnedNoticeCursor } from "./learned-notice-state.js";
import { markTurnGovernanceShown } from "./turn-governance.js";
import { recordPreparedTerminalContext } from "./terminal-turn-observation.js";
import { launchTerminalTurnSettlements } from "./terminal-turn-settlement.js";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-contract.js";

export async function prepareAndRecordTerminalPrompt({
  root,
  executionRoot = root,
  prompt,
  providerSessionId,
  transcriptPath,
  provider,
  observationId,
  workspaceBinding,
  timing,
  coordinates,
  contractId,
  occurredAt,
  deadlineMs,
}: {
  /** The repository the turn's evidence, queues, and shared state belong to. */
  root: string;
  /** The checkout the session works in; a linked worktree differs from `root`. */
  executionRoot?: string;
  prompt: string;
  providerSessionId: string;
  transcriptPath?: string | undefined;
  provider: TerminalIntegrationProvider;
  observationId: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  timing: TerminalStageObservationPort;
  coordinates: UnmanagedTerminalCoordinates;
  contractId: "lervo_terminal_hooks_v1" | "lervo_terminal_hooks_v2";
  occurredAt: string;
  deadlineMs: number;
}): Promise<string> {
  // ADR-0542: record only the transcript position; the resident reads the turn later.
  const transcript = await terminalTranscriptPosition(provider, transcriptPath);
  const transcriptAbsent =
    transcript === null ? await absentTerminalTranscript(provider, transcriptPath) : null;
  const prepared = await timing.measure("context_assembly", () =>
    prepareTerminalPromptContext({
      root,
      executionRoot,
      prompt: prompt,
      provider,
      workspaceBinding,
      timing,
      observationId,
    }),
  );
  // A fresh clone has no generated knowledge; say so instead of implying no matches.
  const bootstrapNotice = await terminalKnowledgeBootstrapNotice({
    root,
    hookRuntime: process.env.LERVO_TERMINAL_HOOK_RUNTIME,
    now: new Date(occurredAt),
  }).catch(() => null);
  const context =
    bootstrapNotice === null
      ? prepared
      : { ...prepared, additionalContext: `${prepared.additionalContext}\n${bootstrapNotice}` };
  const observationEventId = newTerminalIdentifier("evt");
  const observationStorage = await timing.measure("event_commit", () => openProjectStorage(root));
  try {
    await timing.measure("event_commit", async () => {
      await recordPreparedTerminalContext({
        root,
        executionRoot,
        provider,
        coordinates,
        observationId,
        context,
        workspaceBinding,
        occurredAt,
        eventId: observationEventId,
        storage: observationStorage,
        transcript,
        transcriptAbsent,
        providerSessionId,
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
  // ADR-0548 and ADR-0549: only a context that every step above prepared successfully is the one
  // the provider receives, so delivery is recorded last. A failure loses only these observations.
  await recordOwnerTurnStopAppearance(root, context, occurredAt).catch(() => undefined);
  const governance = context.governance;
  if (governance !== undefined && context.additionalContext.includes(governance.line))
    await markTurnGovernanceShown(root, governance.pendingAt, occurredAt).catch(() => undefined);
  const learned = context.learnedNotice;
  if (learned !== undefined && context.additionalContext.includes(learned.line))
    await writeLearnedNoticeCursor(root, learned, occurredAt).catch(() => undefined);
  // A turn this prompt replaced without a Stop, or one an earlier worker never settled.
  await launchTerminalTurnSettlements(root, executionRoot ?? root).catch(() => false);
  return context.additionalContext;
}

async function recordOwnerTurnStopAppearance(
  root: string,
  context: PreparedTerminalPromptContext,
  occurredAt: string,
): Promise<void> {
  const health = context.attention.health ?? null;
  const line =
    health === null ? null : convergenceStopLine(health, new Date(context.attention.observedAt));
  const value = health?.measures.convergence.value ?? null;
  const shown = line !== null && value?.since != null && context.additionalContext.includes(line);
  await recordHealthStopAppearance({
    root,
    stop: shown ? { since: value!.since!, reason: value!.reason } : null,
    at: occurredAt,
  });
}
