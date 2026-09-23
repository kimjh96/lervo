import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { EventDraftV2, EventDraftV3 } from "@lervo/event-contract";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  conversationKnowledgeJobId,
  reconcileConversationKnowledgeOutbox,
} from "../src/conversation-knowledge-outbox-reconciliation.js";

const projectId = "prj_knowledge01";
const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-09-23T00:02:00.000Z";
const roots: string[] = [];

async function openStore() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-knowledge-outbox-"));
  roots.push(root);
  return SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
}

function completion(
  index: number,
  knowledgeDisposition: "current" | "baseline_valid",
): EventDraftV2 {
  const coordinate = String(index).padStart(8, "0");
  return {
    eventId: `evt_completion_${coordinate}`,
    projectId,
    runId: `run_conversation_${coordinate}`,
    sessionId: `ses_conversation_${coordinate}`,
    type: "conversation.repository_work.completed",
    occurredAt: `2026-09-23T00:00:${String(index).padStart(2, "0")}.000Z`,
    actor: { kind: "agent", provider: "codex" },
    schemaVersion: 2,
    policyVersion: hash,
    payload: {
      sourceConversationEventId: `cve_${String(index).padStart(64, "0")}`,
      workerAgentId: `agt_${"b".repeat(24)}`,
      providerSessionDigest: hash,
      requestedModel: null,
      requestedReasoningEffort: null,
      executionProfile: null,
      allocationReason: "configured_default",
      requestContentHash: hash,
      resultContentHash: hash,
      resultByteCount: 4,
      repositoryRevisionBefore: hash,
      repositoryRevisionAfter: hash,
      changedPaths: [],
      changedPathCount: 0,
      workstreamId: `wks_${"c".repeat(24)}`,
      workstreamRevision: 1,
      workstreamSnapshotHash: hash,
      knowledgeDisposition,
      replicaDisposition: "not_configured",
      verificationStatus: "passed",
      completedAt: `2026-09-23T00:00:${String(index).padStart(2, "0")}.000Z`,
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation knowledge outbox reconciliation", () => {
  it("rebuilds only unresolved debt and deduplicates it across restart", async () => {
    const store = await openStore();
    const resolved = store.append(completion(1, "baseline_valid")).event;
    store.append({
      eventId: "evt_knowledge_resolution_0001",
      projectId,
      runId: resolved.runId,
      sessionId: resolved.sessionId,
      type: "conversation.repository_knowledge.resolved",
      occurredAt: "2026-09-23T00:01:00.000Z",
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 3,
      policyVersion: hash,
      payload: {
        completionEventId: resolved.eventId,
        completionEventHash: resolved.eventHash,
        sourceConversationEventId: resolved.payload.sourceConversationEventId,
        jobId: conversationKnowledgeJobId(resolved.eventId),
        agentId: resolved.payload.workerAgentId,
        sourceManifest: { kind: "legacy_unavailable" },
        terminalState: "attention_required",
        attemptCount: 1,
        failureCode: "legacy_source_unavailable",
        knowledgeSnapshotHash: null,
        resolvedAt: "2026-09-23T00:01:00.000Z",
      },
    } satisfies EventDraftV3);
    store.append(completion(2, "current"));
    const pending = store.append(completion(3, "baseline_valid")).event;

    let cursor = 0;
    while (true) {
      const result = reconcileConversationKnowledgeOutbox({
        events: store,
        afterSeq: cursor,
        now,
        pageSize: 1,
      });
      cursor = result.nextAfterSeq;
      if (result.status === "caught_up") break;
    }
    expect(store.listOutbox({ destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION })).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ eventId: pending.eventId }) }),
    ]);

    const path = store.path;
    store.close();
    const reopened = await SQLiteEventStore.open({
      path,
      projectId,
      writableEventSchemaVersion: 3,
    });
    const replay = reconcileConversationKnowledgeOutbox({ events: reopened, afterSeq: 0, now });
    expect(replay).toMatchObject({ status: "caught_up", enqueuedCount: 0, outstandingCount: 1 });
    reopened.close();
  });

  it("stops at exact capacity without advancing past the unqueued completion", async () => {
    const store = await openStore();
    const first = store.append(completion(1, "baseline_valid")).event;
    const second = store.append(completion(2, "baseline_valid")).event;

    const result = reconcileConversationKnowledgeOutbox({
      events: store,
      afterSeq: 0,
      now,
      maximumOutstanding: 1,
    });
    expect(result).toMatchObject({
      status: "backpressured",
      nextAfterSeq: first.seq,
      inspectedCount: 1,
      enqueuedCount: 1,
      outstandingCount: 1,
    });
    expect(store.listOutbox({ destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION })).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ eventId: first.eventId }) }),
    ]);
    expect(second.seq).toBeGreaterThan(result.nextAfterSeq);
    store.close();
  });

  it("refuses a resolution that cites different completion bytes", async () => {
    const store = await openStore();
    const completionEvent = store.append(completion(1, "baseline_valid")).event;
    store.append({
      eventId: "evt_knowledge_conflict_0001",
      projectId,
      runId: completionEvent.runId,
      sessionId: completionEvent.sessionId,
      type: "conversation.repository_knowledge.resolved",
      occurredAt: "2026-09-23T00:01:00.000Z",
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 3,
      policyVersion: hash,
      payload: {
        completionEventId: completionEvent.eventId,
        completionEventHash: hash,
        sourceConversationEventId: completionEvent.payload.sourceConversationEventId,
        jobId: conversationKnowledgeJobId(completionEvent.eventId),
        agentId: completionEvent.payload.workerAgentId,
        sourceManifest: { kind: "legacy_unavailable" },
        terminalState: "attention_required",
        attemptCount: 1,
        failureCode: "legacy_source_unavailable",
        knowledgeSnapshotHash: null,
        resolvedAt: "2026-09-23T00:01:00.000Z",
      },
    } satisfies EventDraftV3);

    expect(() =>
      reconcileConversationKnowledgeOutbox({ events: store, afterSeq: 0, now }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_resolution_conflict" }));
    expect(store.outstandingCount(CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
    store.close();
  });
});
