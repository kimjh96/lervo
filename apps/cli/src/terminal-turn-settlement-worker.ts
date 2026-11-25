// The detached worker that records turns which ended without a Stop hook (event schema 12). A hook
// wrote a settlement request; this records `terminal.turn.observed` with the turn's `ending` and
// `completionResult: not_checked`, its repository change, and its skill assessment.
import { turnEndingEventSchemaVersion } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  planRepositoryChangeInRepository,
  sha256,
} from "@lervo/repository-knowledge";
import {
  enqueueTerminalSkillTurn,
  readRepositoryKnowledgeJobAdmission,
} from "@lervo/repository-knowledge-runtime";
import type { EventEnvelope } from "@lervo/schemas";

import { terminalEventDraft } from "./terminal-event-coordinates.js";
import { inspectTerminalLifecycle } from "./terminal-lifecycle-inspection.js";
import { readPreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";
import { appendTerminalRepositoryChange } from "./terminal-repository-change.js";
import { gitHeadRevision } from "./terminal-repository-revision.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import { resolveCommandRoots } from "./terminal-roots.js";
import { preparedTurnExpectationFromContext } from "./terminal-turn-observation.js";
import {
  acquireTerminalTurnSettlementLease,
  countTerminalTurnSettlementDrops,
  listTerminalTurnSettlements,
  recordTerminalTurnSettlementFailure,
  removeTerminalTurnSettlement,
  settledTerminalTurnEventId,
  type TerminalTurnSettlementRequest,
} from "./terminal-turn-settlement.js";
import { selectedTerminalDocuments } from "./terminal-turn-selection.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

const OBSERVED_PAGE = 200;

/** Whether a `terminal.turn.observed` after `context` already cites it, as a Stop's would. */
function alreadyObserved(storage: ProjectStorage, context: EventEnvelope): boolean {
  let afterSeq = context.seq;
  for (;;) {
    const page = storage.events.list({
      types: ["terminal.turn.observed"],
      afterSeq,
      limit: OBSERVED_PAGE,
    });
    if (
      page.some(
        (event) => (event.payload as Record<string, unknown>).contextEventId === context.eventId,
      )
    )
      return true;
    if (page.length < OBSERVED_PAGE) return false;
    afterSeq = page.at(-1)!.seq;
  }
}

/**
 * Records the turn `request` names, unless it was recorded already or its context is gone. Returns
 * whether it recorded one. The repository revisions and change come from the two prepared
 * snapshots, so they do not move with what the next turn does meanwhile. `lifecycleStatus` is the
 * only part that reads live state: the lifecycle observed when the turn was settled.
 */
async function settleTurn(
  root: string,
  storage: ProjectStorage,
  request: TerminalTurnSettlementRequest,
  now: Date,
): Promise<boolean> {
  const eventId = settledTerminalTurnEventId(request.contextEventId);
  const context = storage.events.get(request.contextEventId);
  if (
    context === null ||
    context.type !== "terminal.context.prepared" ||
    storage.events.get(eventId) !== null ||
    alreadyObserved(storage, context)
  )
    return false;
  const payload = context.payload as Record<string, unknown>;
  const executionRoot = request.executionRoot;
  const linked = executionRoot !== root;
  // The request keeps the session only as its digest, which the workspace check accepts.
  const expectation = {
    ...preparedTurnExpectationFromContext(context, request.provider, ""),
    providerSessionDigest: request.providerSessionDigest,
  };
  const before = await readPreparedRepositorySnapshot(executionRoot, expectation.observationId);
  const after =
    request.afterObservationId === null
      ? await captureTerminalRepositorySnapshot(executionRoot)
      : await readPreparedRepositorySnapshot(executionRoot, request.afterObservationId);
  const lifecycle = await inspectTerminalLifecycle(root, expectation, undefined, executionRoot);
  const beforeRevision = before?.revision ?? expectation.repositoryRevision;
  const afterRevision = after?.revision ?? lifecycle.repositoryChange.afterRevision;
  const changed = beforeRevision !== afterRevision;
  const finalWorkstream = await verifiedCurrentWorkstream(storage, executionRoot);
  const occurredAt = now.toISOString();
  // A linked worktree's branch changes are not the repository's (ADR-0633).
  const change =
    !linked &&
    changed &&
    before !== null &&
    after !== null &&
    (storage.writableEventSchemaVersion ?? 1) >= 3
      ? await planRepositoryChangeInRepository({
          repositoryRoot: root,
          projectId: storage.manifest.projectId,
          sourceKind: "terminal_turn",
          sourceEventId: eventId,
          before,
          after,
          occurredAt,
        })
      : null;
  if (change !== null) {
    const stored = await storage.artifacts.put(change.manifestContent);
    if (stored.contentHash !== change.payload.sourceManifest.contentHash)
      throw new Error("The repository change manifest differs from its stored artifact.");
  }
  const admission = await readRepositoryKnowledgeJobAdmission(root);
  const coordinates = {
    runId: context.runId,
    sessionId: context.sessionId,
    providerSessionDigest: request.providerSessionDigest,
    providerTurnDigest:
      typeof payload.providerTurnDigest === "string" ? payload.providerTurnDigest : null,
  };
  const selected = selectedTerminalDocuments(storage.events, context);
  const binding = expectation.workspaceBinding;
  storage.events.transact((transaction) => {
    transaction.append({
      ...terminalEventDraft({
        eventId,
        projectId: storage.manifest.projectId,
        coordinates,
        provider: request.provider,
        type: "terminal.turn.observed",
        occurredAt,
        payload: {
          observationId: `tobs_${sha256(eventId).slice("sha256:".length, "sha256:".length + 32)}`,
          contextEventId: context.eventId,
          referenceEventIds: [],
          referenceCount: 0,
          selectedCount: selected.length,
          pathMentionCount: 0,
          // No Stop hook passed the turn's last message, so nothing it cited is observed.
          referenceTelemetry: "unavailable",
          lifecycleStatus: lifecycle.status,
          completionResult: "not_checked",
          ending: request.ending,
          repositoryRevisionBefore: beforeRevision,
          repositoryRevisionAfter: afterRevision,
          repositoryChanged: changed,
          finalWorkstreamId: finalWorkstream?.workstreamId ?? null,
          finalWorkstreamRevision: finalWorkstream?.revision ?? null,
          finalWorkstreamSnapshotHash:
            finalWorkstream === null ? null : sha256(`${canonicalJson(finalWorkstream)}\n`),
          providerSessionDigest: coordinates.providerSessionDigest,
          providerTurnDigest: coordinates.providerTurnDigest,
          workspaceExecutionKind: binding?.executionKind ?? null,
          workspaceId: binding?.workspaceId ?? null,
          workspaceGeneration: binding?.workspaceGeneration ?? null,
          workspaceRevision: binding?.workspaceRevision ?? null,
          assignmentId: binding?.assignmentId ?? null,
          leaseGeneration: binding?.leaseGeneration ?? null,
          writerSessionId: binding?.writerSessionId ?? null,
          workspaceCheckpointEventId: null,
        },
      }),
      schemaVersion: turnEndingEventSchemaVersion,
    });
    if (change !== null)
      appendTerminalRepositoryChange(transaction, {
        projectId: storage.manifest.projectId,
        coordinates,
        provider: request.provider,
        occurredAt,
        change,
        admission,
      });
  });
  // The practice-usage projection needs a skill assessment for every observed turn.
  await enqueueTerminalSkillTurn(root, {
    provider: request.provider,
    providerSessionDigest: request.providerSessionDigest,
    providerTurnDigest: coordinates.providerTurnDigest,
    contextEventId: context.eventId,
    turnEventId: eventId,
    repositoryRevision: await gitHeadRevision(executionRoot),
    start: request.transcriptStart,
    end: request.transcriptEnd,
    enqueuedAt: occurredAt,
  });
  return true;
}

/**
 * Settles every pending request of the repository `cwd` belongs to, under the single-flight lease:
 * a second worker finds it held and leaves. Below writer schema 12 nothing can be recorded, so the
 * requests are dropped and counted. A request that fails is retried by a later worker and dropped
 * and counted after its last attempt; one that recorded, or whose turn needs no record, is removed.
 */
export async function settleTerminalTurns(cwd: string, now = () => new Date()): Promise<number> {
  const { evidenceRoot: root } = await resolveCommandRoots(cwd);
  const release = await acquireTerminalTurnSettlementLease(root, now());
  if (release === null) return 0;
  let settled = 0;
  try {
    const requests = await listTerminalTurnSettlements(root, now());
    if (requests.length === 0) return 0;
    const storage = await openProjectStorage(root);
    try {
      if ((storage.writableEventSchemaVersion ?? 1) < turnEndingEventSchemaVersion) {
        for (const request of requests)
          await removeTerminalTurnSettlement(root, request.contextEventId);
        await countTerminalTurnSettlementDrops(root, "writer_below_schema_12", requests.length);
        return 0;
      }
      for (const request of requests) {
        try {
          if (await settleTurn(root, storage, request, now())) settled += 1;
          await removeTerminalTurnSettlement(root, request.contextEventId);
        } catch {
          await recordTerminalTurnSettlementFailure(root, request);
        }
      }
    } finally {
      await storage.close();
    }
  } finally {
    await release();
  }
  return settled;
}
