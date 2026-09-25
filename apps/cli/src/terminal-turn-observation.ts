import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  validateSchema,
  type EventEnvelope,
  type TerminalTurnDeclaredEventPayload,
} from "@lervo/schemas";
import {
  canonicalJson,
  sha256,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import {
  allTerminalEvents,
  assertTerminalRepositoryRelativePath,
  newTerminalIdentifier,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import type {
  ParsedTerminalHookInput,
  PreparedTerminalTurnExpectation,
  TerminalLifecycleInspection,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import type {
  PreparedTerminalDocument,
  PreparedTerminalPromptContext,
} from "./terminal-prompt-context.js";
import { writePreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";
import {
  appendTerminalRepositoryChange,
  plannedTerminalRepositoryChange,
} from "./terminal-repository-change.js";
import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

const EVIDENCE_TOKEN = /lervo-ref:(concept_[a-f0-9]{24}):(sha256:[a-f0-9]{64})/gu;

export function latestTerminalTurnDeclaration(
  events: ProjectStorage["events"],
  contextEventId: string,
  provider: TerminalIntegrationProvider,
): { event: EventEnvelope; payload: TerminalTurnDeclaredEventPayload } | null {
  const declarations = allTerminalEvents(events).filter(
    (event) =>
      event.type === "terminal.turn.declared" &&
      event.actor.kind === "agent" &&
      event.actor.provider === provider &&
      event.payload.contextEventId === contextEventId,
  );
  const event = declarations.at(-1);
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
  const completed = allTerminalEvents(events)
    .filter(
      (event) =>
        event.type === "deliberation.completed" &&
        event.payload.deliberationId === declaration.deliberationId,
    )
    .at(-1);
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
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedTerminalCoordinates;
  observationId: string;
  context: PreparedTerminalPromptContext;
  workspaceBinding: TerminalWorkspaceBinding | null;
  occurredAt: string;
  eventId?: string;
  storage?: ProjectStorage;
}): Promise<string> {
  input.context.documents.forEach((document) =>
    assertTerminalRepositoryRelativePath(document.path),
  );
  await writePreparedRepositorySnapshot(input.root, {
    schemaVersion: 1,
    observationId: input.observationId,
    revision: input.context.repositoryRevision,
    files: input.context.repositoryFiles,
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
    loadingStatus: input.context.selection.selectedCount > 0 ? "observed" : "not_run",
    hookPreparationStatus: "observed",
    providerInjectionStatus: "unobserved",
    providerUseStatus: "unknown",
    contextHash: sha256(input.context.additionalContext),
    recommendationCount: input.context.recommendationCount,
    loadedDocuments: input.context.documents,
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
    return result.event.eventId;
  } finally {
    if (input.storage === undefined) await storage.close();
  }
}

function findLatestPreparedContext(
  events: ProjectStorage["events"],
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
) {
  let afterSeq = 0;
  let found: ReturnType<typeof events.list>[number] | null = null;
  while (true) {
    const batch = events.list({ runId: coordinates.runId, afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch) {
      afterSeq = event.seq;
      if (
        event.type !== "terminal.context.prepared" ||
        event.actor.kind !== "provider" ||
        event.actor.provider !== provider
      )
        continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload.providerSessionDigest !== coordinates.providerSessionDigest) continue;
      if (
        coordinates.providerTurnDigest !== null &&
        payload.providerTurnDigest !== coordinates.providerTurnDigest
      )
        continue;
      found = event;
    }
    if (batch.length < 1000) break;
  }
  return found;
}

export async function preparedTerminalTurnExpectation(
  root: string,
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): Promise<PreparedTerminalTurnExpectation | null> {
  const storage = await openProjectStorage(root);
  try {
    const context = findLatestPreparedContext(storage.events, coordinates, provider);
    if (context === null) return null;
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
    if (!bothNull && !bothPresent)
      throw new Error("Prepared workstream coordinates are incomplete.");
    if (
      typeof repositoryRevision !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(repositoryRevision)
    )
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
  } finally {
    await storage.close();
  }
}

function observedReferences(
  lastAssistantMessage: string | null | undefined,
  documents: PreparedTerminalDocument[],
): PreparedTerminalDocument[] {
  if (typeof lastAssistantMessage !== "string") return [];
  const expected = new Map(
    documents.map((document) => [`${document.conceptId}\0${document.contentHash}`, document]),
  );
  const observed = new Map<string, PreparedTerminalDocument>();
  for (const match of lastAssistantMessage.matchAll(
    new RegExp(EVIDENCE_TOKEN.source, EVIDENCE_TOKEN.flags),
  )) {
    const key = `${match[1]}\0${match[2]}`;
    const document = expected.get(key);
    if (document !== undefined) observed.set(key, document);
  }
  return [...observed.values()];
}

export async function recordObservedTerminalTurn(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedTerminalCoordinates;
  hookInput: ParsedTerminalHookInput;
  lifecycle: TerminalLifecycleInspection;
  workspaceCheckpointEventId: string | null;
  occurredAt: string;
}): Promise<{ eventId: string; referenceCount: number; knowledgeJobQueued: boolean }> {
  const storage = await openProjectStorage(input.root);
  try {
    const context = findLatestPreparedContext(storage.events, input.coordinates, input.provider);
    if (context === null)
      throw new Error("No matching prepared terminal context exists for this provider turn.");
    const payload = context.payload as Record<string, unknown>;
    if (!Array.isArray(payload.loadedDocuments))
      throw new Error("Prepared terminal context evidence is incomplete.");
    const documents = payload.loadedDocuments as unknown as PreparedTerminalDocument[];
    for (const document of documents) assertTerminalRepositoryRelativePath(document.path);
    const references = observedReferences(input.hookInput.lastAssistantMessage, documents);
    const finalWorkstream = await verifiedCurrentWorkstream(storage);
    const referenceEventIds = references.map(() => newTerminalIdentifier("evt"));
    const turnEventId = newTerminalIdentifier("evt");
    const change = await plannedTerminalRepositoryChange({
      root: input.root,
      storage,
      contextPayload: payload,
      lifecycle: input.lifecycle,
      turnEventId,
      occurredAt: input.occurredAt,
    });
    storage.events.transact((transaction) => {
      references.forEach((document, index) =>
        transaction.append(
          terminalEventDraft({
            eventId: referenceEventIds[index]!,
            projectId: storage.manifest.projectId,
            coordinates: input.coordinates,
            provider: input.provider,
            type: "terminal.reference.observed",
            occurredAt: input.occurredAt,
            payload: {
              observationId: newTerminalIdentifier("tobs"),
              contextEventId: context.eventId,
              conceptId: document.conceptId,
              path: document.path,
              contentHash: document.contentHash,
              scope: document.scope,
              referenceKind: "output_citation",
              providerSessionDigest: input.coordinates.providerSessionDigest,
              providerTurnDigest: input.coordinates.providerTurnDigest,
            },
          }),
        ),
      );
      transaction.append(
        terminalEventDraft({
          eventId: turnEventId,
          projectId: storage.manifest.projectId,
          coordinates: input.coordinates,
          provider: input.provider,
          type: "terminal.turn.observed",
          occurredAt: input.occurredAt,
          payload: {
            observationId: newTerminalIdentifier("tobs"),
            contextEventId: context.eventId,
            referenceEventIds,
            referenceCount: references.length,
            referenceTelemetry:
              typeof input.hookInput.lastAssistantMessage === "string" ? "observed" : "unavailable",
            lifecycleStatus: input.lifecycle.status,
            completionResult:
              input.lifecycle.workspace?.binding.executionKind === "worker" &&
              input.lifecycle.status === "action_required"
                ? "blocked"
                : "allowed",
            repositoryRevisionBefore: input.lifecycle.repositoryChange.beforeRevision,
            repositoryRevisionAfter: input.lifecycle.repositoryChange.afterRevision,
            repositoryChanged: input.lifecycle.repositoryChange.changed,
            finalWorkstreamId: finalWorkstream?.workstreamId ?? null,
            finalWorkstreamRevision: finalWorkstream?.revision ?? null,
            finalWorkstreamSnapshotHash:
              finalWorkstream === null ? null : sha256(`${canonicalJson(finalWorkstream)}\n`),
            providerSessionDigest: input.coordinates.providerSessionDigest,
            providerTurnDigest: input.coordinates.providerTurnDigest,
            workspaceExecutionKind: input.lifecycle.workspace?.binding.executionKind ?? null,
            workspaceId: input.lifecycle.workspace?.binding.workspaceId ?? null,
            workspaceGeneration: input.lifecycle.workspace?.binding.workspaceGeneration ?? null,
            workspaceRevision: input.lifecycle.workspace?.binding.workspaceRevision ?? null,
            assignmentId: input.lifecycle.workspace?.binding.assignmentId ?? null,
            leaseGeneration: input.lifecycle.workspace?.binding.leaseGeneration ?? null,
            writerSessionId: input.lifecycle.workspace?.binding.writerSessionId ?? null,
            workspaceCheckpointEventId: input.workspaceCheckpointEventId,
          },
        }),
      );
      if (change !== null)
        appendTerminalRepositoryChange(transaction, {
          projectId: storage.manifest.projectId,
          coordinates: input.coordinates,
          provider: input.provider,
          occurredAt: input.occurredAt,
          change,
        });
    });
    return {
      eventId: turnEventId,
      referenceCount: references.length,
      knowledgeJobQueued: change !== null,
    };
  } finally {
    await storage.close();
  }
}
