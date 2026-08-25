import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  collectRunEventsBounded,
  visitEventSnapshot,
  type ListEventsOptions,
} from "../src/index.js";

function event(seq: number, runId = "run_reader_0001"): EventEnvelope {
  return { seq, runId } as EventEnvelope;
}

function reader(values: readonly EventEnvelope[]) {
  return {
    list: vi.fn((options: ListEventsOptions = {}) =>
      values
        .filter(
          (item) =>
            item.seq > (options.afterSeq ?? 0) &&
            (options.runId === undefined || item.runId === options.runId),
        )
        .slice(0, options.limit ?? 100),
    ),
  };
}

describe("bounded event reader contract", () => {
  it("distinguishes an exact-size run from overflow with one bounded look-ahead", () => {
    const exact = reader([event(1), event(2)]);
    expect(
      collectRunEventsBounded({
        events: exact,
        runId: "run_reader_0001",
        maximumEvents: 2,
        pageSize: 1,
      }).map((item) => item.seq),
    ).toEqual([1, 2]);
    expect(exact.list).toHaveBeenCalledTimes(3);

    const overflow = reader([event(1), event(2), event(3)]);
    expect(() =>
      collectRunEventsBounded({
        events: overflow,
        runId: "run_reader_0001",
        maximumEvents: 2,
        pageSize: 1,
      }),
    ).toThrow(expect.objectContaining({ code: "event_limit_exceeded" }));
  });

  it("rejects a non-forward page and a page from another run", () => {
    const nonForward = { list: () => [event(1), event(1)] };
    expect(() =>
      collectRunEventsBounded({
        events: nonForward,
        runId: "run_reader_0001",
        maximumEvents: 3,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));

    const wrongRun = { list: () => [event(1, "run_reader_other")] };
    expect(() =>
      collectRunEventsBounded({
        events: wrongRun,
        runId: "run_reader_0001",
        maximumEvents: 3,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
  });

  it("visits only the fixed snapshot and fails when its head cannot be reached", () => {
    const values = [event(1), event(2), event(3)];
    const visited: number[] = [];
    visitEventSnapshot({
      events: reader(values),
      throughSeq: 2,
      visit: (item) => visited.push(item.seq),
    });
    expect(visited).toEqual([1, 2]);

    expect(() =>
      visitEventSnapshot({
        events: reader([event(1)]),
        throughSeq: 2,
        visit: () => undefined,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
  });
});
