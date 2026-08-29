import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  linkedEvidenceShadowPolicy,
  projectLinkedEvidenceShadow,
  type LinkedEvidenceShadowSource,
} from "../src/index.js";

function source(documentId: string, path: string, text: string): LinkedEvidenceShadowSource {
  return {
    documentId,
    path,
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    text,
  };
}

describe("linked evidence shadow projection", () => {
  it("uses recommendation and link order, deduplicates, and never recurses", () => {
    const linked = source("doc_linked", "docs/linked.md", "[deep](deep.md)");
    const deep = source("doc_deep", "docs/deep.md", "deep");
    const first = source(
      "doc_first",
      "docs/first.md",
      "[linked](linked.md) [duplicate](linked.md) [external](https://example.com/x)",
    );
    const second = source("doc_second", "docs/second.md", "[deep](deep.md)");

    const result = projectLinkedEvidenceShadow({
      corpus: [first, second, linked, deep],
      recommendations: [first, second],
      existingPaths: [first.path, second.path],
    });

    expect(result.policy).toEqual(linkedEvidenceShadowPolicy);
    expect(result.selectedPaths).toEqual([linked.path, deep.path]);
    expect(result.links).toEqual([
      { linkedFromPath: first.path, linkedPath: linked.path },
      { linkedFromPath: second.path, linkedPath: deep.path },
    ]);
    expect(result.candidateCount).toBe(2);
    expect(result.ignoredCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("stops at the exact byte prefix and rejects changed recommendation bytes", () => {
    const firstTarget = source("doc_one", "docs/one.md", "a".repeat(40_000));
    const secondTarget = source("doc_two", "docs/two.md", "b".repeat(30_000));
    const recommendation = source("doc_seed", "docs/seed.md", "[one](one.md) [two](two.md)");
    const corpus = [recommendation, firstTarget, secondTarget];
    const result = projectLinkedEvidenceShadow({
      corpus,
      recommendations: [recommendation],
      existingPaths: [recommendation.path],
    });

    expect(result.selectedPaths).toEqual([firstTarget.path]);
    expect(result.byteCount).toBe(40_000);
    expect(result.truncated).toBe(true);
    expect(() =>
      projectLinkedEvidenceShadow({
        corpus,
        recommendations: [{ ...recommendation, text: `${recommendation.text} changed` }],
        existingPaths: [recommendation.path],
      }),
    ).toThrow(expect.objectContaining({ code: "shadow_source_unavailable" }));
  });
});
