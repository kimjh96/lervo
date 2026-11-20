import {
  canonicalJson,
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
} from "@lervo/repository-knowledge";
import type { OutboxStore } from "@lervo/storage-contract";

import { foreignEventsHead } from "./resident-authored-events.js";

const DESTINATIONS = [
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
] as const;
const PAGE = 1_000;

/**
 * Canonical event head and knowledge outbox shape. A truncated listing reports an already due
 * delivery, so an unobserved row can only cause a full cycle, never a skipped one. ADR-0598: the
 * head leaves out the resident's own outcome records, whose follow-up is in the outbox read here.
 */
export function observeConvergenceQueue(events: OutboxStore): {
  eventsHead: string | null;
  outboxOutstanding: Record<string, number>;
  earliestAvailableAt: number | null;
} {
  const outboxOutstanding: Record<string, number> = {};
  let earliestAvailableAt: number | null = null;
  const consider = (value: number) => {
    earliestAvailableAt = Math.min(
      earliestAvailableAt ?? value,
      Number.isFinite(value) ? value : 0,
    );
  };
  for (const destinationId of DESTINATIONS) {
    const outstanding = events.outstandingCount(destinationId);
    outboxOutstanding[destinationId] = outstanding;
    if (outstanding === 0) continue;
    const pending = events.listOutbox({ destinationId, status: "pending", limit: PAGE });
    const leased = events.listOutbox({ destinationId, status: "leased", limit: PAGE });
    if (pending.length === PAGE || leased.length === PAGE) consider(0);
    for (const delivery of pending) consider(Date.parse(delivery.availableAt));
    for (const delivery of leased) consider(Date.parse(delivery.lease?.expiresAt ?? ""));
  }
  return { eventsHead: foreignEventsHead(events), outboxOutstanding, earliestAvailableAt };
}

/**
 * ADR-0598: what wakes a resident. It is the event and outbox part of the fence, so a wake means
 * the next cycle can see a change: a foreign event, or knowledge work enqueued or rescheduled by
 * any process, including a stage another command recorded. The resident's own outcome records
 * change neither. An unreadable outbox falls back to the event head alone.
 */
export function residentWakeKey(events: OutboxStore): string | null {
  try {
    return canonicalJson(observeConvergenceQueue(events));
  } catch {
    return foreignEventsHead(events);
  }
}
