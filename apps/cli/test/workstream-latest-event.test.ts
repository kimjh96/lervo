import { expect, it } from "vitest";

import { latestWorkstreamEvent } from "../src/workstream-services.js";

/** A store of snapshot events, newest last, that pages newest first as the SQLite store does. */
function storage(workstreams: string[]) {
  const events = workstreams.map((workstreamId, index) => ({
    seq: index + 1,
    type: "workstream.snapshot.recorded",
    payload: { workstreamId },
  }));
  const pages: number[] = [];
  return {
    pages,
    store: {
      events: {
        list: () => [],
        listNewestFirst: ({
          limit = 100,
          beforeSeq = Infinity,
        }: {
          limit?: number;
          beforeSeq?: number;
        }) => {
          pages.push(limit);
          return events
            .filter((event) => event.seq < beforeSeq)
            .reverse()
            .slice(0, limit);
        },
      },
    } as never,
  };
}

it("finds the newest snapshot from a small first page", () => {
  const { store, pages } = storage(["ws_a", "ws_b", "ws_a"]);
  expect(latestWorkstreamEvent(store, "ws_a")).toMatchObject({ seq: 3 });
  expect(pages).toEqual([4]);
});

it("pages further when the workstream's newest snapshot is older than the first page", () => {
  const { store, pages } = storage(["ws_old", ...Array.from({ length: 150 }, () => "ws_new")]);
  expect(latestWorkstreamEvent(store, "ws_old")).toMatchObject({ seq: 1 });
  expect(pages).toEqual([4, 100, 100]);
  expect(latestWorkstreamEvent(store, "ws_missing")).toBeNull();
});
