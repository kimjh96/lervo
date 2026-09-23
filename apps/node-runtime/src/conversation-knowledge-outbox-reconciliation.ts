import { createHash } from "node:crypto";

import type { EventEnvelope } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";

export const CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION = "knowledge:conversation";
export const MAXIMUM_CONVERSATION_KNOWLEDGE_OUTSTANDING = 1_024;

const MAXIMUM_RECONCILIATION_PAGE = 1_000;

export class ConversationKnowledgeReconciliationError extends Error {
  constructor(
    readonly code: "knowledge_resolution_conflict" | "knowledge_queue_capacity_exceeded",
    message: string,
  ) {
    super(message);
    this.name = "ConversationKnowledgeReconciliationError";
  }
}

export function conversationKnowledgeJobId(completionEventId: string): string {
  return `kjb_${createHash("sha256")
    .update(`lervo.conversation.knowledge-job.v1\0${completionEventId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function needsKnowledgeJob(event: EventEnvelope): boolean {
  return (
    event.type === "conversation.repository_work.completed" &&
    (event.payload.knowledgeDisposition === "pending_background" ||
      event.payload.knowledgeDisposition === "baseline_valid")
  );
}

function hasResolution(events: OutboxStore, completion: EventEnvelope): boolean {
  const outcomes = collectRunEventsBounded({
    events,
    runId: completion.runId,
    maximumEvents: MAXIMUM_RECONCILIATION_PAGE,
  }).filter((event) => event.type === "conversation.repository_knowledge.resolved");
  const completionPayload = completion.payload;
  const invalid = outcomes.some((event) => {
    const payload = event.payload;
    const manifest = payload.sourceManifest as {
      kind?: string;
      contentHash?: string;
      byteCount?: number;
    };
    const sourceManifestMatches =
      completionPayload.knowledgeDisposition === "pending_background"
        ? manifest.kind === "content_bound" &&
          manifest.contentHash === completionPayload.sourceManifestContentHash &&
          manifest.byteCount === completionPayload.sourceManifestByteCount
        : manifest.kind === "legacy_unavailable";
    return (
      payload.completionEventId !== completion.eventId ||
      payload.completionEventHash !== completion.eventHash ||
      payload.sourceConversationEventId !== completionPayload.sourceConversationEventId ||
      payload.jobId !== conversationKnowledgeJobId(completion.eventId) ||
      !sourceManifestMatches
    );
  });
  if (outcomes.length > 1 || invalid) {
    throw new ConversationKnowledgeReconciliationError(
      "knowledge_resolution_conflict",
      "The knowledge outcome conflicts with its canonical conversation completion.",
    );
  }
  return outcomes.length === 1;
}

/** Rebuilds a bounded local queue page from canonical completions without touching the live turn. */
export function reconcileConversationKnowledgeOutbox(input: {
  events: OutboxStore;
  afterSeq: number;
  now: string;
  pageSize?: number;
  maximumOutstanding?: number;
}): {
  status: "caught_up" | "more" | "backpressured";
  nextAfterSeq: number;
  inspectedCount: number;
  enqueuedCount: number;
  outstandingCount: number;
} {
  const pageSize = input.pageSize ?? 100;
  const maximumOutstanding = input.maximumOutstanding ?? MAXIMUM_CONVERSATION_KNOWLEDGE_OUTSTANDING;
  if (
    !Number.isSafeInteger(input.afterSeq) ||
    input.afterSeq < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAXIMUM_RECONCILIATION_PAGE ||
    !Number.isSafeInteger(maximumOutstanding) ||
    maximumOutstanding < 1 ||
    maximumOutstanding > MAXIMUM_CONVERSATION_KNOWLEDGE_OUTSTANDING
  ) {
    throw new TypeError("The conversation knowledge reconciliation bounds are invalid.");
  }
  const throughSeq = input.events.latest()?.seq ?? 0;
  const page = input.events
    .list({ afterSeq: input.afterSeq, limit: pageSize })
    .filter((event) => event.seq <= throughSeq);
  let nextAfterSeq = input.afterSeq;
  let enqueuedCount = 0;
  let inspectedCount = 0;
  for (const event of page) {
    if (event.seq <= nextAfterSeq) {
      throw new ConversationKnowledgeReconciliationError(
        "knowledge_resolution_conflict",
        "The event reader returned a non-forward reconciliation page.",
      );
    }
    if (needsKnowledgeJob(event) && !hasResolution(input.events, event)) {
      try {
        const enqueued = input.events.transact((transaction) => {
          const result = transaction.enqueue({
            eventId: event.eventId,
            destinationId: CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
            enqueuedAt: input.now,
          });
          if (
            transaction.outstandingCount(CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION) >
            maximumOutstanding
          ) {
            throw new ConversationKnowledgeReconciliationError(
              "knowledge_queue_capacity_exceeded",
              "The local knowledge-job queue reached its outstanding capacity.",
            );
          }
          return result.inserted;
        });
        if (enqueued) enqueuedCount += 1;
      } catch (error) {
        if (
          error instanceof ConversationKnowledgeReconciliationError &&
          error.code === "knowledge_queue_capacity_exceeded"
        ) {
          return {
            status: "backpressured",
            nextAfterSeq,
            inspectedCount,
            enqueuedCount,
            outstandingCount: input.events.outstandingCount(
              CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
            ),
          };
        }
        throw error;
      }
    }
    nextAfterSeq = event.seq;
    inspectedCount += 1;
  }
  return {
    status: nextAfterSeq >= throughSeq ? "caught_up" : "more",
    nextAfterSeq,
    inspectedCount,
    enqueuedCount,
    outstandingCount: input.events.outstandingCount(CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION),
  };
}
