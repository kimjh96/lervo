import { expect, it, vi } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";

import { workstreamSnapshotEvents } from "../src/workstream-services.js";

it("pages workstream snapshots through the type index, never the whole history", () => {
  // 1,500 snapshots in a much longer log: the store returns only the requested type.
  const list = vi.fn((options: ListEventsOptions) => {
    const after = options.afterSeq ?? 0;
    const remaining = Math.max(0, 1500 - after);
    return Array.from(
      { length: Math.min(options.limit ?? 1000, remaining) },
      (_, index) =>
        ({
          seq: after + index + 1,
          type: "workstream.snapshot.recorded",
          payload: { workstreamId: "one" },
        }) as unknown as EventEnvelope,
    );
  });
  const events = [...workstreamSnapshotEvents({ events: { list } } as never)];
  expect(events).toHaveLength(1500);
  expect(list).toHaveBeenCalledTimes(2);
  for (const [options] of list.mock.calls)
    expect(options).toMatchObject({ types: ["workstream.snapshot.recorded"], limit: 1000 });
  expect(list.mock.calls[1]![0]).toMatchObject({ afterSeq: 1000 });
});

it("yields only snapshot events from a store that ignores the type filter", () => {
  const list = vi.fn(() => [
    { seq: 1, type: "workstream.snapshot.recorded", payload: {} },
    { seq: 2, type: "terminal.context.prepared", payload: {} },
  ]);
  const events = [...workstreamSnapshotEvents({ events: { list } } as never)];
  expect(events.map((event) => event.seq)).toEqual([1]);
});
