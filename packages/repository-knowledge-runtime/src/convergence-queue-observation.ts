import {
  canonicalJson,
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
} from "@lervo/repository-knowledge";
import type { OutboxStore } from "@lervo/storage-contract";

import { foreignEventsHead } from "./resident-authored-events.js";

/**
 * The knowledge destinations a resident observes. Only the convergence owner drains them; a
 * non-owner cycle claims none (ADR-0597), so ADR-0601 leaves them out of a non-owner's queue.
 */
const OWNER_DRAINED_DESTINATIONS = [
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
] as const;
const PAGE = 1_000;

type Queue = Pick<
  OutboxStore,
  | "latest"
  | "latestHash"
  | "latestHashExcluding"
  | "outstandingCount"
  | "outboxSummary"
  | "listOutbox"
>;

/**
 * Outstanding count and the earliest moment the destination's work is due. ADR-0601: one
 * aggregate read when the store has it. The listing fallback reports a truncated page as already
 * due, so an unobserved row can only cause a full cycle, never a skipped one.
 */
function destinationQueue(
  events: Queue,
  destinationId: string,
): { outstanding: number; dueAt: number[] } {
  if (events.outboxSummary !== undefined) {
    const summary = events.outboxSummary(destinationId);
    return {
      outstanding: summary.outstanding,
      dueAt: [summary.earliestAvailableAt, summary.earliestLeaseExpiresAt].flatMap((value) =>
        value === null ? [] : [Date.parse(value)],
      ),
    };
  }
  const outstanding = events.outstandingCount(destinationId);
  if (outstanding === 0) return { outstanding, dueAt: [] };
  const pending = events.listOutbox({ destinationId, status: "pending", limit: PAGE });
  const leased = events.listOutbox({ destinationId, status: "leased", limit: PAGE });
  return {
    outstanding,
    dueAt: [
      ...(pending.length === PAGE || leased.length === PAGE ? [0] : []),
      ...pending.map((delivery) => Date.parse(delivery.availableAt)),
      ...leased.map((delivery) => Date.parse(delivery.lease?.expiresAt ?? "")),
    ],
  };
}

/**
 * Canonical event head and knowledge outbox shape. ADR-0598: the head leaves out the resident's
 * own outcome records, whose follow-up is in the outbox read here. ADR-0601: a non-owner reads no
 * outbox, because it drains none of these destinations; a role change moves its fence through
 * ownership instead.
 */
export function observeConvergenceQueue(
  events: Queue,
  options: { owner?: boolean } = {},
): {
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
  if (options.owner !== false)
    for (const destinationId of OWNER_DRAINED_DESTINATIONS) {
      const queue = destinationQueue(events, destinationId);
      outboxOutstanding[destinationId] = queue.outstanding;
      if (queue.outstanding === 0) continue;
      for (const at of queue.dueAt) consider(at);
    }
  return { eventsHead: foreignEventsHead(events), outboxOutstanding, earliestAvailableAt };
}

/**
 * ADR-0598: what wakes a resident. It is the event and outbox part of the fence, so a wake means
 * the next cycle can see a change: a foreign event, or knowledge work enqueued or rescheduled by
 * any process, including a stage another command recorded. The resident's own outcome records
 * change neither. An unreadable outbox falls back to the event head alone. ADR-0601: a non-owner
 * is woken by foreign events only, never by a backlog that its owner drains elsewhere.
 */
export function residentWakeKey(events: Queue, owner = true): string | null {
  try {
    return canonicalJson(observeConvergenceQueue(events, { owner }));
  } catch {
    return foreignEventsHead(events);
  }
}
