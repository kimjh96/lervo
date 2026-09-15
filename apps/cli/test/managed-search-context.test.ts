import { describe, expect, it } from "vitest";

import { managedSearchQuery, summarizeManagedSearchContext } from "../src/repository-context.js";

describe("managed search query projection", () => {
  it("bounds a long task without changing the managed run request", () => {
    const projected = managedSearchQuery(`feature ${"word ".repeat(80)}`, "src/result.ts");

    expect(projected.length).toBeLessThanOrEqual(500);
    expect(projected.split(" ")).toHaveLength(32);
  });

  it("uses the expected path only when the task has no searchable term", () => {
    expect(managedSearchQuery("✨ ---", "src/result.ts")).toBe("src result ts");
  });

  it("projects bounded referenced document IDs from canonical E4 evidence", () => {
    const summary = summarizeManagedSearchContext(
      "sattempt_fixture",
      "sattempt_knowledge_fixture",
      [
        { state: "referenced", documentId: "doc_reference_2" },
        { state: "referenced", documentId: "doc_reference_1" },
        { state: "referenced", documentId: "doc_reference_2" },
        { state: "injected", documentId: "doc_injected_only" },
      ] as never,
    );

    expect(summary).toMatchObject({
      referencedDocuments: 2,
      referencedDocumentIds: ["doc_reference_1", "doc_reference_2"],
    });
  });
});
