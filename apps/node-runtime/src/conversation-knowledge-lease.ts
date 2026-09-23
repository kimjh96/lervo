import type { EventEnvelope } from "@lervo/schemas";
import type { OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import {
  CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION,
  conversationKnowledgeJobId,
} from "./conversation-knowledge-outbox-reconciliation.js";

export class ConversationKnowledgeLeaseError extends Error {
  constructor(
    readonly code: "knowledge_job_lease_conflict" | "knowledge_job_completion_invalid",
    message: string,
  ) {
    super(message);
    this.name = "ConversationKnowledgeLeaseError";
  }
}

export interface LeasedConversationKnowledgeJob {
  completion: EventEnvelope;
  jobId: string;
  changedPathCount: number;
  attemptCount: number;
  leaseExpiresAt: string;
}

/** Re-reads one exact queue row and its canonical event; an old claim never grants work authority. */
export function readLeasedConversationKnowledgeJob(input: {
  events: Pick<OutboxStore, "get" | "getOutbox">;
  claimed: OutboxDelivery;
  workerId: string;
  now: string;
}): LeasedConversationKnowledgeJob {
  const { claimed, workerId } = input;
  const now = Date.parse(input.now);
  const current =
    claimed.destinationId === CONVERSATION_KNOWLEDGE_OUTBOX_DESTINATION
      ? input.events.getOutbox(claimed.event.eventId, claimed.destinationId)
      : null;
  const canonical = input.events.get(claimed.event.eventId);
  if (
    !Number.isFinite(now) ||
    current === null ||
    canonical === null ||
    claimed.status !== "leased" ||
    claimed.lease === null ||
    current.status !== "leased" ||
    current.lease === null ||
    claimed.lease.workerId !== workerId ||
    current.lease.workerId !== workerId ||
    current.lease.claimedAt !== claimed.lease.claimedAt ||
    current.lease.expiresAt !== claimed.lease.expiresAt ||
    current.attemptCount !== claimed.attemptCount ||
    now < Date.parse(current.lease.claimedAt) ||
    now >= Date.parse(current.lease.expiresAt) ||
    current.event.eventId !== claimed.event.eventId ||
    current.event.eventHash !== claimed.event.eventHash ||
    current.event.seq !== claimed.event.seq ||
    canonical.eventHash !== current.event.eventHash ||
    canonical.seq !== current.event.seq
  )
    throw new ConversationKnowledgeLeaseError(
      "knowledge_job_lease_conflict",
      "The conversation knowledge job lease or canonical event changed.",
    );
  if (
    canonical.type !== "conversation.repository_work.completed" ||
    typeof canonical.payload.changedPathCount !== "number" ||
    !Number.isSafeInteger(canonical.payload.changedPathCount) ||
    canonical.payload.changedPathCount < 0 ||
    !(
      (canonical.schemaVersion === 3 &&
        canonical.payload.knowledgeDisposition === "pending_background") ||
      (canonical.schemaVersion === 2 && canonical.payload.knowledgeDisposition === "baseline_valid")
    )
  )
    throw new ConversationKnowledgeLeaseError(
      "knowledge_job_completion_invalid",
      "The leased event is not an eligible conversation knowledge completion.",
    );
  return {
    completion: canonical,
    jobId: conversationKnowledgeJobId(canonical.eventId),
    changedPathCount: canonical.payload.changedPathCount,
    attemptCount: current.attemptCount,
    leaseExpiresAt: current.lease.expiresAt,
  };
}
