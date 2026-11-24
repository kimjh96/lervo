import { expect, it, vi } from "vitest";
import type { ListEventsOptions } from "@lervo/storage-contract";

import { findLatestPreparedContext } from "../src/terminal-prepared-context-query.js";

const coordinates = {
  runId: "run_unmanaged_one",
  sessionId: "ses_unmanaged_one",
  providerSessionDigest: `sha256:${"a".repeat(64)}`,
  providerTurnDigest: null,
};

function prepared(seq: number, sessionDigest = coordinates.providerSessionDigest) {
  return {
    eventId: `evt_${String(seq).padStart(32, "0")}`,
    seq,
    runId: coordinates.runId,
    type: "terminal.context.prepared",
    actor: { kind: "provider", provider: "claude" },
    payload: { providerSessionDigest: sessionDigest },
  };
}

/** A store that honors runId, types and afterSeq, recording each page request. */
function store(events: ReturnType<typeof prepared>[]) {
  const list = vi.fn((options: ListEventsOptions) =>
    events
      .filter(
        (event) =>
          event.seq > (options.afterSeq ?? 0) &&
          (options.runId === undefined || event.runId === options.runId) &&
          (options.types === undefined || options.types.includes(event.type)),
      )
      .slice(0, options.limit ?? 100),
  );
  const get = vi.fn((eventId: string) => events.find((event) => event.eventId === eventId) ?? null);
  return { list, get };
}

it("reads only prepared events after the open-turn hint", () => {
  const events = Array.from({ length: 50 }, (_, index) => prepared(index + 1));
  const fake = store(events);
  const found = findLatestPreparedContext(
    fake as never,
    coordinates,
    "claude",
    events[49]!.eventId,
  );
  expect(found?.seq).toBe(50);
  expect(fake.list).toHaveBeenCalledTimes(1);
  expect(fake.list.mock.calls[0]![0]).toMatchObject({
    afterSeq: 50,
    runId: coordinates.runId,
    types: ["terminal.context.prepared"],
  });
});

it("finds a later context than a stale hint, and ignores a hint from another session", () => {
  const events = [prepared(1), prepared(2), prepared(3, `sha256:${"b".repeat(64)}`), prepared(4)];
  // The marker still names seq 1 because a later marker write failed.
  expect(
    findLatestPreparedContext(store(events) as never, coordinates, "claude", events[0]!.eventId)
      ?.seq,
  ).toBe(4);
  // A hint naming another session's context is not taken; the run is read from the start.
  const fake = store(events);
  expect(
    findLatestPreparedContext(fake as never, coordinates, "claude", events[2]!.eventId)?.seq,
  ).toBe(4);
  expect(fake.list.mock.calls[0]![0]).toMatchObject({ afterSeq: 0 });
  // Without a hint the answer is the same.
  expect(findLatestPreparedContext(store(events) as never, coordinates, "claude")?.seq).toBe(4);
});
