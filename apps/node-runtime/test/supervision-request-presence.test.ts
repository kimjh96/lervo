import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";
import {
  BoundSupervisionRequestPresence,
  findBoundSupervisionRequestEvent,
} from "../src/supervision-request-presence.js";

const binding = {
  supervisionId: "supervision.project",
  workstreamId: `wks_${"a".repeat(24)}`,
  ownerAgentId: `agt_${"b".repeat(24)}`,
  mandateHash: `sha256:${"c".repeat(64)}`,
};
const projectId = `prj_${"f".repeat(16)}`;

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    seq: 1,
    eventId: `evt_${"d".repeat(32)}`,
    eventHash: `sha256:${"e".repeat(64)}`,
    previousHash: null,
    projectId,
    runId: `run_${"1".repeat(32)}`,
    sessionId: `ses_${"2".repeat(32)}`,
    type: "work.supervision.bound",
    schemaVersion: 3,
    occurredAt: "2026-09-22T00:00:00.000Z",
    actor: { kind: "system" },
    policyVersion: `sha256:${"3".repeat(64)}`,
    payload: {
      supervisionId: binding.supervisionId,
      workstreamId: binding.workstreamId,
      ownerAgentId: binding.ownerAgentId,
    },
    ...overrides,
  } as EventEnvelope;
}

function filler(seq: number): EventEnvelope {
  return event({
    seq,
    eventId: `evt_${String(seq).padStart(32, "0")}`,
    eventHash: `sha256:${String(seq).padStart(64, "0")}`,
    type: "run.requested",
    payload: {},
  });
}

function bound(seq: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return event({
    seq,
    eventId: `evt_${String(seq).padStart(32, "b")}`,
    eventHash: `sha256:${String(seq).padStart(64, "b")}`,
    ...overrides,
  });
}

/** An append-only in-memory store; `honorTypes: false` models a store that ignores the filter. */
function store(initial: EventEnvelope[] = [], honorTypes = true) {
  const rows = [...initial];
  const reads = { listed: 0 };
  return {
    rows,
    reads,
    append: (item: EventEnvelope) => rows.push(item),
    get: (eventId: string) => rows.find((item) => item.eventId === eventId) ?? null,
    latest: () => rows.at(-1) ?? null,
    list: ({ afterSeq = 0, limit = 100, types }: ListEventsOptions = {}) => {
      const page = rows
        .filter((item) => item.seq > afterSeq)
        .filter((item) => !honorTypes || types === undefined || types.includes(item.type))
        .slice(0, limit);
      reads.listed += page.length;
      return page;
    },
  };
}

function outcome(read: () => EventEnvelope | null): EventEnvelope | string | null {
  try {
    return read();
  } catch (error) {
    return (error as Error).message;
  }
}

describe("bound supervision request presence", () => {
  it("finds only the exact project, workstream, supervision and owner coordinate", () => {
    const exact = event();
    expect(
      findBoundSupervisionRequestEvent({ events: store([exact]), projectId, binding }),
    ).toEqual(exact);
    expect(
      findBoundSupervisionRequestEvent({
        events: store([event({ projectId: `prj_${"0".repeat(16)}` })]),
        projectId,
        binding,
      }),
    ).toBeNull();
  });

  it("rejects multiple origins instead of selecting one", () => {
    expect(() =>
      findBoundSupervisionRequestEvent({
        events: store([event(), event({ seq: 2, eventId: `evt_${"4".repeat(32)}` })]),
        projectId,
        binding,
      }),
    ).toThrow(/conflicting request origins/iu);
  });

  it("rejects an absent origin with the dormant health failure code", () => {
    expect(() =>
      new BoundSupervisionRequestPresence({ events: store(), projectId, binding }).assert(),
    ).toThrow(expect.objectContaining({ code: "supervision_workstream_inactive" }));
  });

  it("finds the origin in a history far beyond 100,000 events by reading only origin events", () => {
    for (const honorTypes of [true, false]) {
      const rows = [filler(1), bound(120_000), filler(150_000)];
      const events = store(rows, honorTypes);
      expect(findBoundSupervisionRequestEvent({ events, projectId, binding })?.seq).toBe(120_000);
      const presence = new BoundSupervisionRequestPresence({ events, projectId, binding });
      expect(presence.find()?.seq).toBe(120_000);
      events.append(bound(150_001));
      expect(outcome(() => presence.find())).toMatch(/conflicting request origins/iu);
    }
  });

  it("bounds the origin events one read retains, not the history length", () => {
    const others = Array.from({ length: 100_001 }, (_, index) =>
      bound(index + 1, { payload: { ...event().payload, workstreamId: `wks_${"9".repeat(24)}` } }),
    );
    expect(() =>
      findBoundSupervisionRequestEvent({ events: store(others), projectId, binding }),
    ).toThrow(/origins exceed their observation bound/iu);
    expect(
      findBoundSupervisionRequestEvent({ events: store(others.slice(1)), projectId, binding }),
    ).toBeNull();
  });

  it("answers exactly like a full scan after every append, including a late conflicting origin", () => {
    for (const honorTypes of [true, false]) {
      const appends = [
        filler(1),
        filler(2),
        bound(3, { workstreamId: `wks_${"9".repeat(24)}` } as Partial<EventEnvelope>),
        filler(4),
        bound(5),
        filler(6),
        bound(7, { schemaVersion: 2 } as Partial<EventEnvelope>),
        filler(8),
        bound(9),
        filler(10),
      ];
      const events = store([], honorTypes);
      const presence = new BoundSupervisionRequestPresence({ events, projectId, binding });
      for (const item of appends) {
        events.append(item);
        const full = outcome(() =>
          findBoundSupervisionRequestEvent({ events: store([...events.rows]), projectId, binding }),
        );
        expect(outcome(() => presence.find())).toEqual(full);
      }
      // The conflict is sticky: the incremental reader keeps failing like the full scan.
      expect(outcome(() => presence.find())).toMatch(/conflicting request origins/iu);
    }
  });

  it("reads only the appended tail while the anchor holds", () => {
    const rows = Array.from({ length: 2_500 }, (_, index) => filler(index + 1));
    rows[1_200] = bound(1_201);
    const events = store(rows, false);
    const presence = new BoundSupervisionRequestPresence({ events, projectId, binding });
    expect(presence.find()?.seq).toBe(1_201);
    const fullRead = events.reads.listed;
    events.append(filler(2_501));
    expect(presence.find()?.seq).toBe(1_201);
    expect(events.reads.listed - fullRead).toBe(1);
  });

  it("rescans fully when the anchor no longer verifies or the full-read interval lapses", () => {
    let now = 1_000_000;
    const events = store([filler(1), bound(2), filler(3)]);
    const presence = new BoundSupervisionRequestPresence({
      events,
      projectId,
      binding,
      now: () => now,
    });
    expect(presence.find()?.seq).toBe(2);

    // An out-of-band rewrite below the head replaces the anchor event: full rescan.
    events.rows.splice(0, events.rows.length, filler(1), filler(2), {
      ...filler(3),
      eventHash: `sha256:${"7".repeat(64)}`,
    });
    expect(presence.find()).toBeNull();

    // A rewrite below an unchanged anchor stays invisible only until the bounded full re-read.
    events.rows.splice(1, 1, bound(2));
    expect(presence.find()).toBeNull();
    now += 900_000;
    expect(presence.find()?.seq).toBe(2);

    // A clock rollback also forces a full read.
    events.rows.splice(1, 1, filler(2));
    now -= 1;
    expect(presence.find()).toBeNull();
  });
});
