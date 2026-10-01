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
      [source],
    ),
  ).toThrowError(expect.objectContaining({ code: "knowledge_semantic_review_invalid" }));
  expect(
    parseCanonicalAssessment(
      { decisions: [{ ...decision, disposition: "no_change" }], drafts: [] },
      [source],
      [],
      [source],
    ).drafts,
  ).toEqual([]);
});

it("binds every proposed target to the complete captured source snapshot", () => {
  const source = {
    path: "src/runtime.ts",
    contentHash: sha256("export const version = 2;\n"),
    kind: "text" as const,
  };
  const target = {
    path: "docs/foundation/ci-quality-and-commit-gates.md",
    contentHash: sha256("# Existing gates\n"),
  };
  const decision = {
    path: source.path,
    contentHash: source.contentHash,
    disposition: "candidate" as const,
    rationale:
      "The changed runtime behavior needs a reviewed canonical statement tied to the existing quality gates document.",
    canonicalReferences: [],
  };
  const draft = { path: target.path, beforeHash: null, content: "# Revised gates\n" };
  const parse = (beforeHash: string | null) =>
    parseCanonicalAssessment(
      { decisions: [decision], drafts: [{ ...draft, beforeHash }] },
      [source],
      [],
      [source, target],
    );
  expect(() => parse(null)).toThrowError(
    expect.objectContaining({ code: "knowledge_semantic_review_invalid" }),
  );
  expect(() => parse(sha256("# Different gates\n"))).toThrowError(
    expect.objectContaining({ code: "knowledge_semantic_review_invalid" }),
  );
  expect(parse(target.contentHash).drafts[0]?.beforeHash).toBe(target.contentHash);
  expect(
    parseCanonicalAssessment(
      { decisions: [decision], drafts: [{ ...draft, path: "docs/foundation/new-gates.md" }] },
      [source],
      [],
      [source, target],
    ).drafts[0]?.beforeHash,
  ).toBeNull();
});
