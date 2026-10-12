import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  collectEventsOfTypesBounded,
  collectProjectEventsBounded,
  collectRunEventsBounded,
  visitEventSnapshot,
  type ListEventsOptions,
} from "../src/index.js";

function event(seq: number, runId = "run_reader_0001"): EventEnvelope {
  return {
    seq,
    runId,
    previousHash: seq === 1 ? null : `hash_${seq - 1}`,
    eventHash: `hash_${seq}`,
  } as EventEnvelope;
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
  it("collects a whole project with the same exact overflow distinction", () => {
    const exact = reader([event(1), event(2, "run_reader_0002")]);
    expect(
      collectProjectEventsBounded({ events: exact, maximumEvents: 2, pageSize: 1 }).map(
        (item) => item.seq,
      ),
    ).toEqual([1, 2]);
    expect(exact.list).toHaveBeenCalledTimes(3);

    expect(() =>
      collectProjectEventsBounded({
        events: reader([event(1), event(2), event(3)]),
        maximumEvents: 2,
        pageSize: 1,
      }),
    ).toThrow(expect.objectContaining({ code: "event_limit_exceeded" }));
  });

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

  it("collects only the requested types in order with the same overflow distinction", () => {
    const typed = (seq: number, type: string) => ({ ...event(seq), type }) as EventEnvelope;
    const values = [typed(1, "a"), typed(2, "b"), typed(3, "a"), typed(4, "c")];
    const store = {
      list: vi.fn((options: ListEventsOptions = {}) =>
        values
          .filter(
            (item) =>
              item.seq > (options.afterSeq ?? 0) &&
              (options.types === undefined || options.types.includes(item.type)),
          )
          .slice(0, options.limit ?? 100),
      ),
    };
    expect(
      collectEventsOfTypesBounded({
        events: store,
        types: ["a", "c"],
        maximumEvents: 3,
        pageSize: 1,
      }).map((item) => item.seq),
    ).toEqual([1, 3, 4]);
    expect(store.list).toHaveBeenCalledTimes(4);
    expect(store.list.mock.calls.every(([options]) => options?.types?.join() === "a,c")).toBe(true);
    expect(() =>
      collectEventsOfTypesBounded({ events: store, types: ["a", "c"], maximumEvents: 2 }),
    ).toThrow(expect.objectContaining({ code: "event_limit_exceeded" }));
    expect(() =>
      collectEventsOfTypesBounded({
        events: { list: () => [typed(1, "b")] },
        types: ["a"],
        maximumEvents: 3,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
    expect(() =>
      collectEventsOfTypesBounded({
        events: { list: () => [typed(2, "a"), typed(1, "a")] },
        types: ["a"],
        maximumEvents: 3,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
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

  it("verifies every predecessor link and the observed head of a project snapshot", () => {
    const visit = () => undefined;
    expect(() =>
      visitEventSnapshot({
        events: reader([event(1), event(2)]),
        throughSeq: 2,
        throughHash: "hash_2",
        visit,
      }),
    ).not.toThrow();
    const broken = [event(1), { ...event(2), previousHash: "hash_other" }, event(3)];
    const gap = [event(1), event(3)];
    for (const values of [broken, gap]) {
      expect(() =>
        visitEventSnapshot({ events: reader(values), throughSeq: 3, visit, pageSize: 1 }),
      ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
      expect(() =>
        collectProjectEventsBounded({ events: reader(values), maximumEvents: 3, pageSize: 1 }),
      ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
    }
    expect(() =>
      visitEventSnapshot({
        events: reader([event(1), event(2)]),
        throughSeq: 2,
        throughHash: "hash_x",
        visit,
      }),
    ).toThrow(expect.objectContaining({ code: "event_sequence_invalid" }));
  });
});
