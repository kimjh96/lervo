import { lifecycleRepositorySnapshot } from "./terminal-lifecycle-snapshot.js";
import { openProjectStorage } from "@lervo/project-storage";
import { gitHeadRevision } from "./terminal-repository-revision.js";
import {
  enqueueTerminalSkillTurn,
  readRepositoryKnowledgeJobAdmission,
  terminalTranscriptPosition,
} from "@lervo/repository-knowledge-runtime";
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
  changedTerminalPaths,
  plannedTerminalRepositoryChange,
} from "./terminal-repository-change.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

import {
  findLatestPreparedContext,
  preparedContextHint,
} from "./terminal-prepared-context-query.js";
import { selectedTerminalDocuments } from "./terminal-turn-selection.js";
import { observedTerminalReferences } from "./terminal-output-references.js";
import {
  closeTerminalTurn,
  openTurnTranscriptStart,
  sessionOpenTerminalTurn,
} from "./terminal-open-turns.js";

export async function recordObservedTerminalTurn(input: {
  root: string;
  /** The checkout the turn worked on; a linked worktree differs from `root`. */
  executionRoot?: string;
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedTerminalCoordinates;
  hookInput: ParsedTerminalHookInput;
  lifecycle: TerminalLifecycleInspection;
  workspaceCheckpointEventId: string | null;
  occurredAt: string;
}): Promise<{
  eventId: string;
  referenceCount: number;
  selectedCount: number;
  pathMentionCount: number;
  knowledgeJobQueued: boolean;
  changedPaths: string[];
  /** Documents this turn selected or loaded, for the ADR-0552 governance check. */
  consultedPaths: string[];
}> {
  const hint = await preparedContextHint(input.root, input.coordinates, new Date(input.occurredAt));
  const storage = await openProjectStorage(input.root);
  let contextEventId: string | null = null;
  try {
    const context = findLatestPreparedContext(
      storage.events,
      input.coordinates,
      input.provider,
      hint,
    );
    if (context === null)
      throw new Error("No matching prepared terminal context exists for this provider turn.");
    contextEventId = context.eventId;
    const payload = context.payload as Record<string, unknown>;
    if (!Array.isArray(payload.loadedDocuments))
      throw new Error("Prepared terminal context evidence is incomplete.");
    const documents = payload.loadedDocuments as unknown as PreparedTerminalDocument[];
    for (const document of documents) assertTerminalRepositoryRelativePath(document.path);
    // Path mentions need a proven turn: an exact turn digest, or this session's open-turn marker
    // naming the same context. Otherwise a later prompt's selections could be matched to this
    // reply, so no path mention is recorded and the marker is left for its own turn.
    const marker = await sessionOpenTerminalTurn(
      input.root,
      input.coordinates.providerSessionDigest,
      new Date(input.occurredAt),
    );
    const proven =
      input.coordinates.providerTurnDigest !== null || marker?.contextEventId === context.eventId;
    if (!proven) contextEventId = null;
    const selected = proven ? selectedTerminalDocuments(storage.events, context) : [];
    const references = observedTerminalReferences({
      lastAssistantMessage: input.hookInput.lastAssistantMessage,
      loaded: documents,
      selected,
    });
    const pathMentionCount = references.filter(
      (reference) => reference.referenceKind === "path_mention",
    ).length;
    const checkout = input.executionRoot ?? input.root;
    // A linked worktree's branch changes are not the repository's: they record the turn's changed
    // paths but no repository change, so no knowledge job applies branch bytes to the main checkout.
    const linked = checkout !== input.root;
    const finalWorkstream = await verifiedCurrentWorkstream(storage, checkout);
    const referenceEventIds = references.map(() => newTerminalIdentifier("evt"));
    const turnEventId = newTerminalIdentifier("evt");
    const transcriptEnd = await terminalTranscriptPosition(
      input.provider,
      input.hookInput.transcriptPath,
    );
    // The HEAD lifecycle inspection's snapshot just read, instead of another `git` process.
    const inspectedCommits = lifecycleRepositorySnapshot(input.lifecycle, checkout)?.commits;
    const repositoryRevision =
      (inspectedCommits === undefined ? undefined : Object.values(inspectedCommits)[0]) ??
      (await gitHeadRevision(checkout));
    // ADR-0605: only a host that runs knowledge jobs receives one.
    const admission = await readRepositoryKnowledgeJobAdmission(input.root);
    let knowledgeJobQueued = false;
    const change = linked
      ? null
      : await plannedTerminalRepositoryChange({
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
              ...document,
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
            selectedCount: selected.length,
            pathMentionCount,
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
        knowledgeJobQueued = appendTerminalRepositoryChange(transaction, {
          projectId: storage.manifest.projectId,
          coordinates: input.coordinates,
          provider: input.provider,
          occurredAt: input.occurredAt,
          change,
          admission,
        });
    });
    await enqueueTerminalSkillTurn(input.root, {
      provider: input.provider,
      providerSessionDigest: input.coordinates.providerSessionDigest,
      providerTurnDigest: input.coordinates.providerTurnDigest,
      contextEventId: context.eventId,
      turnEventId,
      repositoryRevision,
      // The transcript range starts at this turn's own prompt only when its marker is proven.
      start:
        marker?.contextEventId === context.eventId
          ? openTurnTranscriptStart(marker, transcriptEnd, input.hookInput.transcriptPath)
          : null,
      end: transcriptEnd,
      enqueuedAt: input.occurredAt,
    });
    return {
      eventId: turnEventId,
      referenceCount: references.length,
      selectedCount: selected.length,
      pathMentionCount,
      knowledgeJobQueued,
      consultedPaths: [
        ...new Set([...selected.map((item) => item.path), ...documents.map((item) => item.path)]),
      ],
      changedPaths: linked
        ? await changedTerminalPaths(checkout, payload, input.lifecycle)
        : change
          ? (JSON.parse(change.manifestContent) as { paths: { path: string }[] }).paths.map(
              (item) => item.path,
            )
          : [],
    };
  } finally {
    if (contextEventId !== null)
      await closeTerminalTurn(
        input.root,
        input.coordinates.providerSessionDigest,
        contextEventId,
        new Date(input.occurredAt),
      );
    await storage.close();
  }
}
