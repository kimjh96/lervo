import { vi } from "vitest";

import type { EventStore } from "../src/index.js";

/**
 * Fails every project-wide read that has neither a type nor a run filter. A reader that still
 * passes answers from the events it needs, so the length of the surrounding history cannot fail it.
 */
export function rejectWholeHistoryReads(events: Pick<EventStore, "list">) {
  const list = events.list.bind(events);
  return vi.spyOn(events, "list").mockImplementation((options) => {
    if (options?.types === undefined && options?.runId === undefined)
      throw new Error("A reader walked the whole project history.");
    return list(options);
  });
}
