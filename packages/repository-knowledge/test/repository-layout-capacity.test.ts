import { defaultDecisionTaxonomy } from "@lervo/project";
import { describe, expect, it } from "vitest";

import type { RepositoryLayoutCandidate } from "../src/repository-layout-candidates.js";
import { holdRepositoryLayoutMovesOverCapacity } from "../src/repository-layout-capacity.js";
import type { RepositoryKnowledgeScan } from "../src/types.js";

const hash = `sha256:${"a".repeat(64)}`;
const notes = Array.from(
  { length: 33 },
  (_, index) => `v8/notes/n${String(index).padStart(2, "0")}.md`,
);
const scan = {
  sources: ["README.md", "docs/x.md", ...notes].map((path) => ({
    path,
    status: "included",
    contentHash: hash,
  })),
} as unknown as RepositoryKnowledgeScan;
const move = (from: string, to: string) =>
  ({ source: { path: from, contentHash: hash }, toPath: to }) as RepositoryLayoutCandidate;

describe("layout migration capacity holds (ADR-0583)", () => {
  it("keeps a rename inside an over-limit directory and holds a move into it", () => {
    const result = holdRepositoryLayoutMovesOverCapacity({
      scan,
      taxonomy: defaultDecisionTaxonomy,
      candidates: [
        move("v8/notes/n00.md", "v8/notes/renamed.md"),
        move("docs/x.md", "v8/notes/x.md"),
      ],
    });
    expect([...result.heldDestinations]).toEqual(["v8/notes/x.md"]);
    expect(result.findings).toEqual([
      {
        code: "document_directory_file_capacity_exceeded",
        directory: "v8/notes",
        observed: 33,
        projected: 34,
        limit: 32,
        disposition: "moves_held",
      },
    ]);
  });

  it("does not hold a rename alone and reports the directory once as existing overflow", () => {
    const result = holdRepositoryLayoutMovesOverCapacity({
      scan,
      taxonomy: defaultDecisionTaxonomy,
      candidates: [move("v8/notes/n00.md", "v8/notes/renamed.md")],
    });
    expect(result.heldDestinations.size).toBe(0);
    expect(result.findings).toEqual([
      expect.objectContaining({ directory: "v8/notes", disposition: "existing_overflow" }),
    ]);
  });
});
