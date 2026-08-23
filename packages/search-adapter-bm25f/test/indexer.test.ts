import { describe, expect, it } from "vitest";

import {
  verifySearchEvaluationEngineContract,
  type SearchSourceInput,
} from "@lervo/search";

import {
  BM25F_ADAPTER_BUILD_ID,
  BM25F_SEARCH_ENGINE,
  Bm25fSearchIndex,
  bm25fSearchEvaluationEngine,
} from "../src/index.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

const sources: SearchSourceInput[] = [
  {
    kind: "document",
    sourceId: "doc_bm25f_common",
    contentHash: HASH_A,
    path: "docs/common.md",
    title: "Common guide",
    labels: ["guide"],
    text: "search search search common document",
  },
  {
    kind: "document",
    sourceId: "doc_bm25f_rare",
    contentHash: HASH_B,
    path: "docs/rare.md",
    title: "Rare evidence",
    labels: ["evidence"],
    text: "search unique-evidence document",
  },
];

describe("bm25f search evaluation adapter", () => {
  it("passes the shared deterministic engine contract", async () => {
    await expect(verifySearchEvaluationEngineContract({
      engine: bm25fSearchEvaluationEngine,
      sources,
      queries: ["search", "unique-evidence"],
    })).resolves.toMatchObject({
      engine: BM25F_SEARCH_ENGINE,
      adapterBuildId: BM25F_ADAPTER_BUILD_ID,
      checkedQueries: 2,
    });
  });

  it("uses document frequency and fixed integer scores without exposing the query", () => {
    const response = new Bm25fSearchIndex(sources).search("search unique-evidence", 10);

    expect(response.hits[0]?.source.sourceId).toBe("doc_bm25f_rare");
    expect(response.hits.every((hit) => Number.isSafeInteger(hit.score) && hit.score > 0)).toBe(true);
    expect(JSON.stringify(response)).not.toContain("unique-evidence");
  });

  it("rejects invalid corpus through the shared corpus contract", () => {
    expect(() => new Bm25fSearchIndex([{ ...sources[0]!, text: "" }])).toThrow(/content contract/);
    const index = new Bm25fSearchIndex(sources);
    expect(() => index.search("search", 0)).toThrow(/result limit/);
    expect(() => index.search("search", 51)).toThrow(/result limit/);
  });
});
