import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  sha256,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import {
  assertTerminalRepositoryRelativePath,
  newTerminalIdentifier,
  terminalEventDraft,
} from "./terminal-event-coordinates.js";
import type {
  ParsedTerminalHookInput,
  TerminalLifecycleInspection,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import type { PreparedTerminalDocument } from "./terminal-prompt-context.js";
import {
  appendTerminalRepositoryChange,
  plannedTerminalRepositoryChange,
} from "./terminal-repository-change.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

import { findLatestPreparedContext } from "./terminal-prepared-context-query.js";
const EVIDENCE_TOKEN = /lervo-ref:(concept_[a-f0-9]{24}):(sha256:[a-f0-9]{64})/gu;
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
}): Promise<{
  eventId: string;
  referenceCount: number;
  knowledgeJobQueued: boolean;
  changedPaths: string[];
}> {
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
      changedPaths: change
        ? (JSON.parse(change.manifestContent) as { paths: { path: string }[] }).paths.map(
            (item) => item.path,
          )
        : [],
    };
  } finally {
    await storage.close();
  }
}
