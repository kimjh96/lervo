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

type HistoryEvents = Pick<EventStore, "list" | "get">;

interface HistoryScan {
  history: HealthEventHistory;
  /** The last typed event scanned, or null when the store held none. */
  anchor: { eventId: string; seq: number } | null;
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
  return scanHealthEvents(events, [], null, now).history;
}

function outsideWindow(event: EventEnvelope, activityStart: number): boolean {
  return ACTIVITY_TYPES.includes(event.type) && Date.parse(event.occurredAt) < activityStart;
}

/** Continues from `anchor` over `kept`; a full read starts with neither. */
function scanHealthEvents(
  events: Pick<EventStore, "list">,
  kept: readonly EventEnvelope[],
  anchor: HistoryScan["anchor"],
  now: Date,
): HistoryScan {
  const activityStart = now.getTime() - ACTIVITY_WINDOW_MS;
  // Activity that aged out of the window since the last read leaves the cached history too.
  const found = kept.filter((event) => !outsideWindow(event, activityStart));
  let afterSeq = anchor?.seq ?? 0;
  let last = anchor;
  let scanned = 0;
  while (scanned < MAXIMUM_SCANNED) {
    const page = events.list({
      afterSeq,
      limit: Math.min(1_000, MAXIMUM_SCANNED - scanned),
      types: TYPES,
    });
    if (page.length === 0) return { history: { events: found, complete: true }, anchor: last };
    for (const event of page) {
      scanned += 1;
      if (event.seq <= afterSeq) throw new Error("Health event history did not advance.");
      afterSeq = event.seq;
      last = { eventId: event.eventId, seq: event.seq };
      if (!TYPES.includes(event.type) || outsideWindow(event, activityStart)) continue;
      found.push(event);
      if (found.length > MAXIMUM_EVENTS)
        return {
          history: { events: found.slice(0, MAXIMUM_EVENTS), complete: false },
          anchor: last,
        };
    }
  }
  return { history: { events: found, complete: false }, anchor: last };
}

interface CachedHistory {
  events: EventEnvelope[];
  anchor: NonNullable<HistoryScan["anchor"]>;
}
/** ADR-0599: one cached history per repository in a long-lived resident process. */
const cachedHistories = new Map<string, CachedHistory>();
const MAXIMUM_CACHED_HISTORIES = 64;

/**
 * ADR-0599: the same history as `readHealthEventHistory`, read from where the previous read in
 * this process stopped. The cache is kept only for a complete history whose last event still
 * sits at its sequence; a replaced store, a sequence regression, or a partial read starts over.
 */
export function readHealthEventHistoryIncrementally(
  key: string,
  events: HistoryEvents,
  now = new Date(),
): HealthEventHistory {
  const cached = cachedHistories.get(key);
  cachedHistories.delete(key);
  const resumable =
    cached !== undefined && events.get(cached.anchor.eventId)?.seq === cached.anchor.seq;
  const scan = resumable
    ? scanHealthEvents(events, cached.events, cached.anchor, now)
    : scanHealthEvents(events, [], null, now);
  if (scan.history.complete && scan.anchor !== null) {
    if (cachedHistories.size >= MAXIMUM_CACHED_HISTORIES)
      cachedHistories.delete(cachedHistories.keys().next().value!);
    cachedHistories.set(key, { events: scan.history.events, anchor: scan.anchor });
  }
  return scan.history;
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
