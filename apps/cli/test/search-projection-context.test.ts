import { SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES } from "@lervo/search";
import { describe, expect, it } from "vitest";

import { createCurrentWorkstreamSearchProjectionContext } from "../src/search-projection-context.js";

describe("current workstream search projection context", () => {
  it("deduplicates and bounds reference anchors before provider projection", () => {
    const references = [
      { path: "docs/duplicate.md" },
      { path: "docs/duplicate.md" },
      ...Array.from({ length: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES + 2 }, (_, index) => ({
        path: `docs/reference-${index}.md`,
      })),
    ];

    const projection = createCurrentWorkstreamSearchProjectionContext({
      workstreamId: "wks_0123456789abcdef01234567",
      revision: 1,
      objective: "Prepare bounded repository retrieval context.",
      nextActions: [],
      references,
    });

    expect(projection.contextAnchors).toEqual([
      "docs/duplicate.md",
      ...Array.from(
        { length: SEARCH_QUERY_PROJECTION_MAXIMUM_QUERIES - 1 },
        (_, index) => `docs/reference-${index}.md`,
      ),
    ]);
    expect(projection.context.currentWorkstream.references).toEqual(projection.contextAnchors);
    expect(projection.context.contextAnchors).toEqual(projection.contextAnchors);
  });
});
