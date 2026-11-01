import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

const STAGE_TYPES = [
  "repository.knowledge.stage.recorded",
  "repository.knowledge.convergence.recorded",
];
/** Per-turn activity grows with every prompt, so only its recent window is retained. */
const ACTIVITY_TYPES = [
  "context.injected",
  "context.referenced",
  "terminal.context.prepared",
  "terminal.turn.observed",
];
const TYPES = [...ACTIVITY_TYPES, ...STAGE_TYPES];
const ACTIVITY_WINDOW_MS = 8 * 86_400_000;
const MAXIMUM_EVENTS = 10_000;
const MAXIMUM_SCANNED = 250_000;
const STOPPED = new Set([
  "waiting_review",
  "waiting_authority",
  "attention_required",
  "recovery_required",
  "retry_scheduled",
]);

export interface HealthEventHistory {
  events: EventEnvelope[];
  complete: boolean;
}

/**
 * Bounded typed pages, off the critical path. Stage records are kept whole so a long stop keeps
 * its start; per-turn activity older than eight days is dropped, so prompt volume alone never
 * turns the history partial. Overflow cannot masquerade as a seven-day zero.
 */
export function readHealthEventHistory(
  events: Pick<EventStore, "list">,
  now = new Date(),
): HealthEventHistory {
  const found: EventEnvelope[] = [];
  const activityStart = now.getTime() - ACTIVITY_WINDOW_MS;
  let afterSeq = 0;
  let scanned = 0;
  while (scanned < MAXIMUM_SCANNED) {
    const page = events.list({
      afterSeq,
      limit: Math.min(1_000, MAXIMUM_SCANNED - scanned),
      types: TYPES,
    });
    if (page.length === 0) return { events: found, complete: true };
    for (const event of page) {
      scanned += 1;
      if (event.seq <= afterSeq) throw new Error("Health event history did not advance.");
      afterSeq = event.seq;
      if (!TYPES.includes(event.type)) continue;
      if (ACTIVITY_TYPES.includes(event.type) && Date.parse(event.occurredAt) < activityStart)
        continue;
      found.push(event);
      if (found.length > MAXIMUM_EVENTS)
        return { events: found.slice(0, MAXIMUM_EVENTS), complete: false };
    }
  }
  return { events: found, complete: false };
}

export interface RecordedStop {
  since: string;
  until: string | null;
  state: string;
  reason: string | null;
}

/** Stage time is a stop time; obligation backlog age is deliberately never substituted for it. */
export function recordedConvergenceStops(history: HealthEventHistory, now: Date): RecordedStop[] {
  const open = new Map<string, RecordedStop>();
  const closed: RecordedStop[] = [];
  for (const event of history.events) {
    const at = Date.parse(event.occurredAt);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const p = event.payload as Record<string, unknown>;
    const id = typeof p.obligationId === "string" ? p.obligationId : null;
    if (id === null || !event.type.startsWith("repository.knowledge.")) continue;
    const state = typeof p.state === "string" ? p.state : "current";
    const reason = typeof p.failureCode === "string" ? p.failureCode : null;
    const previous = open.get(id);
    if (previous !== undefined && (!STOPPED.has(state) || previous.reason !== reason)) {
      closed.push({ ...previous, until: event.occurredAt });
      open.delete(id);
    }
    if (STOPPED.has(state) && !open.has(id)) {
      open.set(id, { since: event.occurredAt, until: null, state, reason });
    }
  }
  return [...closed, ...open.values()].filter((stop) => Date.parse(stop.since) <= now.getTime());
}
