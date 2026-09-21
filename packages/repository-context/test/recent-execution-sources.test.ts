import type { RepositorySupplementalSource } from "@lervo/repository-knowledge";
import { describe, expect, it } from "vitest";

import { selectRecentExecutionSources } from "../src/recent-execution-sources.js";

function source(id: string, seq: number): RepositorySupplementalSource {
  return {
    path: `@event/${id}`,
    kind: "execution_event",
    classification: "ordinary",
    content: JSON.stringify({ seq }),
    origin: "execution_event_store",
    unitKind: "event",
    locator: `event:${id}`,
    title: "event",
    adapter: "execution-event-v1+event-chain",
  };
}

describe("interactive execution event window", () => {
  it("selects the newest sequence rather than the highest opaque event ID", () => {
    const sources = [source("z_old", 1), source("b_middle", 2), source("a_new", 3)];
    expect(selectRecentExecutionSources(sources, 2).map((item) => item.path)).toEqual([
      "@event/b_middle",
      "@event/a_new",
    ]);
    expect(sources.map((item) => item.path)).toEqual([
      "@event/z_old",
      "@event/b_middle",
      "@event/a_new",
    ]);
  });

  it("rejects duplicate or invalid sequence evidence", () => {
    expect(() => selectRecentExecutionSources([source("a", 1), source("b", 1)], 2)).toThrow(
      /duplicate sequences/u,
    );
    expect(() => selectRecentExecutionSources([source("a", 1)], 0)).toThrow(/limit is invalid/u);
  });
});
