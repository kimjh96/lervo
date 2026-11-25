import {
  findLatestPreparedContext,
  preparedContextHint,
} from "./terminal-prepared-context-query.js";
import { turnEndingEventSchemaVersion } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  validateSchema,
  type EventEnvelope,
  type TerminalTurnDeclaredEventPayload,
} from "@lervo/schemas";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { TranscriptPosition } from "@lervo/repository-knowledge-runtime";

import {
  latestTerminalEventOfType,
  assertTerminalRepositoryRelativePath,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import type {
  PreparedTerminalTurnExpectation,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import type { PreparedTerminalPromptContext } from "./terminal-prompt-context.js";
import { writePreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";
import { openTerminalTurn } from "./terminal-open-turns.js";
import {
  requestOpenTerminalTurnSettlement,
  terminalExecutionRootDigest,
} from "./terminal-turn-settlement.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";

export function latestTerminalTurnDeclaration(
  events: ProjectStorage["events"],
  contextEventId: string,
  provider: TerminalIntegrationProvider,
): { event: EventEnvelope; payload: TerminalTurnDeclaredEventPayload } | null {
  const event = latestTerminalEventOfType(
    events,
    "terminal.turn.declared",
    (candidate) =>
      candidate.actor.kind === "agent" &&
      candidate.actor.provider === provider &&
      candidate.payload.contextEventId === contextEventId,
  );
  if (event === undefined) return null;
  const validation = validateSchema("terminalTurnDeclaredEventPayload", event.payload);
  if (!validation.valid) throw new Error("The terminal turn declaration event is invalid.");
  return { event, payload: event.payload as TerminalTurnDeclaredEventPayload };
}

export function terminalDeliberationDeclarationMatches(
  events: ProjectStorage["events"],
  declaration: TerminalTurnDeclaredEventPayload,
): boolean {
  if (declaration.deliberationDisposition === "not_requested")
    return declaration.deliberationId === null;
  const completed = latestTerminalEventOfType(
    events,
    "deliberation.completed",
    (event) => event.payload.deliberationId === declaration.deliberationId,
  );
  if (completed === undefined) return false;
  const status = completed.payload.status;
  return (
    (declaration.deliberationDisposition === "completed" && status === "converged") ||
    (declaration.deliberationDisposition === "no_consensus" && status === "no_consensus") ||
    (declaration.deliberationDisposition === "failed" && status === "failed")
  );
}

export async function recordPreparedTerminalContext(input: {
  root: string;
  /** The checkout whose prepared snapshot Stop compares; defaults to `root`. */
  executionRoot?: string;
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedTerminalCoordinates;
  observationId: string;
  context: PreparedTerminalPromptContext;
  workspaceBinding: TerminalWorkspaceBinding | null;
  occurredAt: string;
  eventId?: string;
  storage?: ProjectStorage;
  transcript?: TranscriptPosition | null;
  transcriptAbsent?: string | null;
}): Promise<string> {
  input.context.documents.forEach((document) =>
    assertTerminalRepositoryRelativePath(document.path),
  );
  await writePreparedRepositorySnapshot(input.executionRoot ?? input.root, {
    schemaVersion: 1,
    observationId: input.observationId,
    revision: input.context.repositoryRevision,
    files: input.context.repositoryFiles,
    ...(input.context.repositoryCommits === undefined
      ? {}
      : { commits: input.context.repositoryCommits }),
  });
  const payload = {
    observationId: input.observationId,
    executionMode: "unmanaged",
    providerSessionDigest: input.coordinates.providerSessionDigest,
    providerTurnDigest: input.coordinates.providerTurnDigest,
    sourceSnapshotId: input.context.sourceSnapshotId,
    repositoryRevision: input.context.repositoryRevision,
    requestDigest: input.context.grounding.requestDigest,
    queryDigest: input.context.grounding.queryDigest,
    queryProjectionReceipt: input.context.grounding.queryProjectionReceipt,
    groundingStatus: input.context.grounding.status,
    groundingWorkflowId: input.context.grounding.workflowId,
    groundingSourceClasses: input.context.grounding.sourceClasses,
    groundingSubjectIds: input.context.grounding.subjectIds,
    groundingProviderIds: input.context.grounding.providerIds,
    groundingReasons: input.context.grounding.reasons,
    durableInstructionStatus: input.context.durableInstruction.status,
    durableInstructionRuleId: input.context.durableInstruction.ruleId,
    durableInstructionTargetPath: input.context.durableInstruction.targetPath,
    durableInstructionReasonIds: input.context.durableInstruction.reasonIds,
    selectionStatus: input.context.selection.selectedCount > 0 ? "selected" : "not_selected",
    // ADR-0538 pointers are selected without loading their bodies; only observed loads count.
    loadingStatus:
      input.context.selection.selectedCount > 0 &&
      input.context.preparationQuality.loading === "observed"
        ? "observed"
        : "not_run",
    hookPreparationStatus: "observed",
    providerInjectionStatus: "unobserved",
    providerUseStatus: "unknown",
    contextHash: sha256(input.context.additionalContext),
    recommendationCount: input.context.recommendationCount,
    loadedDocuments: input.context.documents,
    selectedPointers: input.context.selectedPointers ?? [],
    workstreamId: input.context.workstream?.workstreamId ?? null,
    workstreamRevision: input.context.workstream?.revision ?? null,
    workstreamSnapshotHash: input.context.workstream?.snapshotHash ?? null,
    workstreamScope: input.context.workstream?.scope ?? null,
    workstreamDeliveredByteCount: input.context.workstream?.deliveredByteCount ?? null,
    workspaceExecutionKind: input.workspaceBinding?.executionKind ?? null,
    workspaceId: input.workspaceBinding?.workspaceId ?? null,
    workspaceGeneration: input.workspaceBinding?.workspaceGeneration ?? null,
    workspaceRevision: input.workspaceBinding?.workspaceRevision ?? null,
    assignmentId: input.workspaceBinding?.assignmentId ?? null,
    leaseGeneration: input.workspaceBinding?.leaseGeneration ?? null,
    writerSessionId: input.workspaceBinding?.writerSessionId ?? null,
  };
  const validation = validateSchema("terminalContextPreparedEventPayload", payload);
  if (!validation.valid) {
    throw new Error(
      validation.errors
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; "),
    );
  }
  const storage = input.storage ?? (await openProjectStorage(input.root));
  try {
    const result = storage.events.append(
      terminalEventDraft({
        ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
        projectId: storage.manifest.projectId,
        coordinates: input.coordinates,
        provider: input.provider,
        type: "terminal.context.prepared",
        occurredAt: input.occurredAt,
        payload,
      }),
    );
    // Schema 12: the session's previous turn is still open when no Stop hook ran for it, as
    // when the owner interrupted it. This prompt's snapshot settles it, before its marker goes.
    if ((storage.writableEventSchemaVersion ?? 1) >= turnEndingEventSchemaVersion)
      await requestOpenTerminalTurnSettlement({
        root: input.root,
        executionRoot: input.executionRoot ?? input.root,
        provider: input.provider,
        providerSessionDigest: input.coordinates.providerSessionDigest,
        ending: "next_prompt",
        afterObservationId: input.observationId,
        transcriptEnd: input.transcript ?? null,
        now: new Date(input.occurredAt),
      }).catch(() => false);
    await openTerminalTurn(input.root, {
      provider: input.provider,
      providerSessionDigest: input.coordinates.providerSessionDigest,
      providerTurnDigest: input.coordinates.providerTurnDigest,
      contextEventId: result.event.eventId,
      openedAt: input.occurredAt,
      transcript: input.transcript ?? null,
      ...(input.transcriptAbsent ? { transcriptAbsent: input.transcriptAbsent } : {}),
      executionRootDigest: terminalExecutionRootDigest(input.executionRoot ?? input.root),
    });
    return result.event.eventId;
  } finally {
    if (input.storage === undefined) await storage.close();
  }
}

export async function preparedTerminalTurnExpectation(
  root: string,
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): Promise<PreparedTerminalTurnExpectation | null> {
  const hint = await preparedContextHint(root, coordinates);
  const storage = await openProjectStorage(root);
  try {
    const context = findLatestPreparedContext(storage.events, coordinates, provider, hint);
    if (context === null) return null;
    return preparedTurnExpectationFromContext(context, provider, providerSessionId);
  } finally {
    await storage.close();
  }
}

/** What a turn's prepared context expected, read from its `terminal.context.prepared` event. */
export function preparedTurnExpectationFromContext(
  context: EventEnvelope,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): PreparedTerminalTurnExpectation {
  const payload = context.payload as Record<string, unknown>;
  const workstreamId = payload.workstreamId;
  const revision = payload.workstreamRevision;
  const repositoryRevision = payload.repositoryRevision;
  const workspaceExecutionKind = payload.workspaceExecutionKind;
  const workspaceId = payload.workspaceId;
  const workspaceGeneration = payload.workspaceGeneration;
  const workspaceRevision = payload.workspaceRevision;
  const assignmentId = payload.assignmentId;
  const leaseGeneration = payload.leaseGeneration;
  const writerSessionId = payload.writerSessionId;
  const bothNull = workstreamId === null && revision === null;
  const bothPresent =
    typeof workstreamId === "string" && Number.isSafeInteger(revision) && Number(revision) >= 1;
  if (!bothNull && !bothPresent) throw new Error("Prepared workstream coordinates are incomplete.");
  if (typeof repositoryRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(repositoryRevision))
    throw new Error("Prepared repository revision is invalid.");
  if (typeof payload.observationId !== "string")
    throw new Error("Prepared terminal observation coordinate is invalid.");
  const workspaceNull =
    workspaceExecutionKind == null &&
    workspaceId == null &&
    workspaceGeneration == null &&
    workspaceRevision == null &&
    assignmentId == null &&
    leaseGeneration == null &&
    writerSessionId == null;
  const workspacePresent =
    (workspaceExecutionKind === "worker" || workspaceExecutionKind === "integrator") &&
    typeof workspaceId === "string" &&
    Number.isSafeInteger(workspaceGeneration) &&
    Number(workspaceGeneration) >= 1 &&
    Number.isSafeInteger(workspaceRevision) &&
    Number(workspaceRevision) >= 1 &&
    typeof assignmentId === "string" &&
    Number.isSafeInteger(leaseGeneration) &&
    Number(leaseGeneration) >= 1 &&
    typeof writerSessionId === "string";
  if (!workspaceNull && !workspacePresent)
    throw new Error("Prepared workspace coordinates are incomplete.");
  return {
    contextEventId: context.eventId,
    observationId: payload.observationId,
    provider,
    providerSessionId,
    workstreamId: bothPresent ? workstreamId : null,
    revision: bothPresent ? Number(revision) : null,
    repositoryRevision,
    preparedAt: context.occurredAt,
    workspaceBinding: workspacePresent
      ? {
          executionKind: workspaceExecutionKind,
          workspaceId,
          workspaceGeneration: Number(workspaceGeneration),
          workspaceRevision: Number(workspaceRevision),
          assignmentId,
          leaseGeneration: Number(leaseGeneration),
          writerSessionId,
        }
      : null,
  };
}

export { recordObservedTerminalTurn } from "./terminal-stop-observation.js";
