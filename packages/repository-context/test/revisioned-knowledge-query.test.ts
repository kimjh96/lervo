import { describe, expect, it, vi } from "vitest";

import type { RepositoryKnowledgeQueryIndex } from "@lervo/repository-knowledge";

import { RevisionedRepositoryKnowledgeQuery } from "../src/index.js";

describe("revisioned repository knowledge query", () => {
  it("shares one preparation for a revision and reloads after exact revision change", async () => {
    const index = { query: vi.fn() } as unknown as RepositoryKnowledgeQueryIndex;
    const loadIndex = vi.fn(async () => index);
    const query = new RevisionedRepositoryKnowledgeQuery({ loadIndex });

    await Promise.all([
      query.prepare({ repositoryRoot: "/repository", sourceRevision: "revision-1" }),
      query.prepare({ repositoryRoot: "/repository", sourceRevision: "revision-1" }),
    ]);
    await query.prepare({ repositoryRoot: "/repository", sourceRevision: "revision-1" });
    expect(loadIndex).toHaveBeenCalledTimes(1);

    await query.prepare({ repositoryRoot: "/repository", sourceRevision: "revision-2" });
    expect(loadIndex).toHaveBeenCalledTimes(2);
  });
});
