import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import {
  readHealthEventHistory,
  readHealthEventHistoryIncrementally,
} from "../src/repository-health-events.js";

const DAY = 86_400_000;

function event(type: string, seq: number, occurredAt: string): EventEnvelope {
  return { eventId: `evt_${seq}`, type, seq, occurredAt, payload: {} } as unknown as EventEnvelope;
}

/** An event store over `stored` that records every page it was asked for. */
function store(stored: EventEnvelope[]) {
  const pages: number[] = [];
  return {
    stored,
    pages,
    list: ({ afterSeq = 0, limit = 1000, types }: ListEventsOptions = {}) => {
      pages.push(afterSeq);
      return stored
        .filter((item) => item.seq > afterSeq && (types === undefined || types.includes(item.type)))
        .slice(0, limit);
    },
    get: (eventId: string) => stored.find((item) => item.eventId === eventId) ?? null,
  };
}

describe("incremental health history (ADR-0599)", () => {
  it("equals a full read while reading only the events after its last one", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const events = store([
      event("repository.knowledge.stage.recorded", 1, "2026-09-01T00:00:00Z"),
      event("terminal.turn.observed", 2, "2026-11-19T00:00:00Z"),
      event("execution.stages.observed", 3, "2026-11-19T00:00:00Z"),
    ]);
    const key = "/repository/equal";
    expect(readHealthEventHistoryIncrementally(key, events, now)).toEqual(
      readHealthEventHistory(events, now),
    );
    events.stored.push(
      event("terminal.context.prepared", 4, "2026-11-19T12:00:00Z"),
      event("repository.knowledge.stage.recorded", 5, "2026-11-19T13:00:00Z"),
    );
    events.pages.length = 0;
    const incremental = readHealthEventHistoryIncrementally(key, events, now);
    // The cached read starts after the last typed event it saw, never at the start of the log.
    expect(events.pages[0]).toBe(2);
    expect(incremental).toEqual(readHealthEventHistory(events, now));
    expect(incremental.events.map((item) => item.seq)).toEqual([1, 2, 4, 5]);
  });

  it("drops turn activity that aged out of the window since the previous read", () => {
    const events = store([
      event("repository.knowledge.stage.recorded", 1, "2026-09-01T00:00:00Z"),
      event("terminal.turn.observed", 2, "2026-11-10T00:00:00Z"),
    ]);
    const key = "/repository/window";
    const first = new Date("2026-11-11T00:00:00Z");
    expect(readHealthEventHistoryIncrementally(key, events, first).events).toHaveLength(2);
    const later = new Date(Date.parse("2026-11-10T00:00:00Z") + 9 * DAY);
    const history = readHealthEventHistoryIncrementally(key, events, later);
    expect(history).toEqual(readHealthEventHistory(events, later));
    expect(history.events.map((item) => item.type)).toEqual([
      "repository.knowledge.stage.recorded",
    ]);
  });

  it("starts over when the last seen event is gone or moved", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const events = store([
      event("terminal.turn.observed", 1, "2026-11-19T00:00:00Z"),
      event("terminal.turn.observed", 2, "2026-11-19T01:00:00Z"),
    ]);
    const key = "/repository/replaced";
    readHealthEventHistoryIncrementally(key, events, now);
    // A replaced store reuses sequence numbers for different events.
    events.stored.splice(
      0,
      2,
      event("repository.knowledge.stage.recorded", 1, "2026-11-19T02:00:00Z"),
    );
    events.pages.length = 0;
    const history = readHealthEventHistoryIncrementally(key, events, now);
    expect(events.pages[0]).toBe(0);
    expect(history).toEqual(readHealthEventHistory(events, now));
  });

  it("keeps no cache for a partial history", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const events = store(
      Array.from({ length: 10_002 }, (_, index) =>
        event("terminal.turn.observed", index + 1, "2026-11-19T00:00:00Z"),
      ),
    );
    const key = "/repository/partial";
    expect(readHealthEventHistoryIncrementally(key, events, now).complete).toBe(false);
    events.pages.length = 0;
    readHealthEventHistoryIncrementally(key, events, now);
    expect(events.pages[0]).toBe(0);
  });
});
