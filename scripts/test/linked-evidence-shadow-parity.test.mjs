import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { projectLinkedEvidenceShadow } from "../../packages/context/dist/index.js";
import { buildLinkedEvidenceReconciliationV8Expansion } from "../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";

const contract = {
  sourceClass: "lexical_recommendations_only",
  traversal: "repository_markdown_inline_links_v1",
  maximumDepth: 1,
  maximumLinkedSources: 8,
  maximumLinkedSourceBytes: 65_536,
  ordering: "recommendation_then_link_occurrence_prefix_v1",
};

function source(path, text) {
  return {
    documentId: `doc_${createHash("sha256").update(path).digest("hex").slice(0, 24)}`,
    path,
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    text,
  };
}

describe("production linked-evidence shadow parity", () => {
  it("matches the unchanged v8 resolver for every authorized projection boundary", () => {
    const orderedSeed = source(
      "docs/ordered.md",
      [
        "[one](one.md)",
        "[duplicate](one.md)",
        "[excluded](excluded.md)",
        "[missing](missing.md)",
        "[fragment](#local)",
        "[malformed](%zz)",
        "[external](https://example.com)",
      ].join(" "),
    );
    const secondSeed = source("docs/second.md", "[two](two.md)");
    const one = source("docs/one.md", "[nonrecursive](deep.md)");
    const two = source("docs/two.md", "two");
    const deep = source("docs/deep.md", "deep");
    const excluded = source("docs/excluded.md", "excluded");

    const countTargets = Array.from({ length: 9 }, (_, index) =>
      source(`count/${index + 1}.md`, String(index + 1)),
    );
    const countSeed = source(
      "count/seed.md",
      countTargets.map((_, index) => `[${index + 1}](${index + 1}.md)`).join(" "),
    );

    const exact = source("bytes/exact.md", "가".repeat(21_845) + "a");
    const afterExact = source("bytes/after.md", "after");
    const exactSeed = source("bytes/seed.md", "[exact](exact.md) [after](after.md)");
    const prefix = source("bytes/prefix.md", "a".repeat(40_000));
    const overflow = source("bytes/overflow.md", "b".repeat(30_000));
    const overflowSeed = source(
      "bytes/overflow-seed.md",
      "[prefix](prefix.md) [overflow](overflow.md)",
    );

    const cases = [
      {
        corpus: [orderedSeed, secondSeed, one, two, deep, excluded],
        recommendations: [orderedSeed, secondSeed],
        existingPaths: [orderedSeed.path, secondSeed.path, excluded.path],
      },
      {
        corpus: [countSeed, ...countTargets],
        recommendations: [countSeed],
        existingPaths: [countSeed.path],
      },
      {
        corpus: [exactSeed, exact, afterExact],
        recommendations: [exactSeed],
        existingPaths: [exactSeed.path],
      },
      {
        corpus: [overflowSeed, prefix, overflow],
        recommendations: [overflowSeed],
        existingPaths: [overflowSeed.path],
      },
    ];

    for (const input of cases) {
      const reference = buildLinkedEvidenceReconciliationV8Expansion({ ...input, contract });
      const production = projectLinkedEvidenceShadow(input);
      expect({
        sources: production.sources,
        selectedPaths: production.selectedPaths,
        links: production.links,
        candidateCount: production.candidateCount,
        truncated: production.truncated,
        byteCount: production.byteCount,
      }).toEqual(reference);
    }
  });
});
