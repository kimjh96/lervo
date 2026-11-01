import { describe, expect, it } from "vitest";

import { longHistoryEvents } from "../../../packages/storage-contract/test/listed-event-source.fixture.js";
import { event } from "../../../packages/work-controller/test/fixtures.js";
import { latestTerminalEventOfType } from "../src/terminal-event-coordinates.js";

describe("terminal event lookup over long history", () => {
  it("finds the last matching event of one type beyond 100,000 events from a typed read", () => {
    const older = event(1, "terminal.turn.declared", "run_terminal0001", { contextEventId: "a" });
    const other = event(2, "terminal.turn.declared", "run_terminal0001", { contextEventId: "b" });
    const newer = event(3, "terminal.turn.declared", "run_terminal0001", { contextEventId: "a" });
    const long = longHistoryEvents([older, other, newer]);
    const events = { list: long.list, latest: () => long.head };

    const found = latestTerminalEventOfType(
      events,
      "terminal.turn.declared",
      (candidate) => candidate.payload.contextEventId === "a",
    );
    expect(found?.eventId).toBe(newer.eventId);
    expect(
      latestTerminalEventOfType(
        events,
        "terminal.turn.declared",
        (candidate) => candidate.payload.contextEventId === "c",
      ),
    ).toBeUndefined();
  });
});
