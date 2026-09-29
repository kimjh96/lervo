import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { parseCanonicalAssessment } from "../src/canonical-assessment-contract.js";

it("rejects an unchanged draft as a canonical change instead of starting an empty integration", () => {
  const content = "# Runtime\n\nLocal execution remains available without a Hub.\n";
  const source = {
    path: "docs/specs/runtime.md",
    contentHash: sha256(content),
    kind: "text" as const,
    content,
  };
  const decision = {
    path: source.path,
    contentHash: source.contentHash,
    disposition: "candidate" as const,
    rationale:
      "The exact source must preserve the existing independently documented local execution requirement without inventing new changes.",
    canonicalReferences: [],
  };
  expect(() =>
    parseCanonicalAssessment(
      {
        decisions: [decision],
        drafts: [{ path: source.path, beforeHash: source.contentHash, content }],
      },
      [source],
      [],
    ),
  ).toThrowError(expect.objectContaining({ code: "knowledge_semantic_review_invalid" }));
  expect(
    parseCanonicalAssessment(
      { decisions: [{ ...decision, disposition: "no_change" }], drafts: [] },
      [source],
      [],
    ).drafts,
  ).toEqual([]);
});
