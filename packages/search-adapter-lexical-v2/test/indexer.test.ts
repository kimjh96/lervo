import { describe, expect, it } from "vitest";

import { verifySearchEvaluationEngineContract, type SearchSourceInput } from "@lervo/search";

import {
  LEXICAL_V2_ADAPTER_BUILD_ID,
  LEXICAL_V2_SEARCH_ENGINE,
  LexicalV2SearchIndex,
  LexicalV2FieldAnalysisCache,
  lexicalV2SearchEvaluationEngine,
} from "../src/index.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

const sources: SearchSourceInput[] = [
  {
    kind: "document",
    sourceId: "doc_runtime",
    contentHash: HASH_A,
    path: "docs/runtime.md",
    title: "Runtime recovery",
    labels: ["execution"],
    text: "Interrupted execution recovers from canonical events.",
  },
  {
    kind: "document",
    sourceId: "doc_adapter",
    contentHash: HASH_B,
    path: "docs/searchAdapterBuildId.md",
    title: "SearchAdapterBuildId contract",
    labels: ["search-adapter"],
    text: "Every adapter build identity is content bound and replayable.",
  },
  {
    kind: "document",
    sourceId: "doc_normalization",
    contentHash: HASH_C,
    path: "docs/normalization.md",
    title: "Document normalization",
    labels: ["documents"],
    text: "Normalize reviewed documents before compilation.",
  },
];

describe("lexical v2 search evaluation adapter", () => {
  it("passes the shared deterministic engine contract", async () => {
    await expect(
      verifySearchEvaluationEngineContract({
        engine: lexicalV2SearchEvaluationEngine,
        sources,
        queries: ["runtime recovery", "searchAdapterBuildId", "normalizing documents"],
      }),
    ).resolves.toMatchObject({
      engine: LEXICAL_V2_SEARCH_ENGINE,
      adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
      checkedQueries: 3,
    });
  });

  it("splits camel-case identifiers without adding a raw-query field", () => {
    const response = new LexicalV2SearchIndex(sources).search("searchAdapterBuildId", 10);
    const separated = new LexicalV2SearchIndex(sources).search("search_adapter_build_id", 10);

    expect(response.hits[0]?.source.sourceId).toBe("doc_adapter");
    expect(separated.hits[0]?.source.sourceId).toBe("doc_adapter");
    expect(response.hits[0]?.matchedFields).toEqual(expect.arrayContaining(["path", "title"]));
    expect(response).not.toHaveProperty("query");
  });

  it("matches identifier components against ordinary document terms", () => {
    const response = new LexicalV2SearchIndex(sources).search("runtime-recovery", 10);

    expect(response.hits[0]?.source.sourceId).toBe("doc_runtime");
  });

  it("uses bounded trigrams for morphology variation", () => {
    const response = new LexicalV2SearchIndex(sources).search("normalizing", 10);

    expect(response.hits[0]?.source.sourceId).toBe("doc_normalization");
    expect(response.hits.every((hit) => Number.isSafeInteger(hit.score) && hit.score > 0)).toBe(
      true,
    );
  });

  it("does not pretend that character similarity provides cross-language recall", () => {
    expect(new LexicalV2SearchIndex(sources).search("배포 승인", 10).hits).toEqual([]);
  });

  it("rejects invalid limits through the shared query contract", () => {
    const index = new LexicalV2SearchIndex(sources);
    expect(() => index.search("runtime", 0)).toThrow(/result limit/);
    expect(() => index.search("runtime", 51)).toThrow(/result limit/);
  });

  it("reuses unchanged fields while preserving complete ranking, scores, metadata and negative results", () => {
    const queries = [
      "runtime recovery",
      "searchAdapterBuildId",
      "search_adapter_build_id",
      "normalizing",
      "Runtime  RECOVERY",
      "배포 승인",
      "qzxvnjkqzvnmqjkx",
    ];
    const full = new LexicalV2SearchIndex(sources);
    const cold = new LexicalV2FieldAnalysisCache();
    const first = new LexicalV2SearchIndex(sources, { fieldCache: cold });
    const persisted = structuredClone(cold.snapshot()) as { entries: unknown[] };
    expect(JSON.stringify(persisted)).not.toContain(sources[0]!.text);
    const warm = new LexicalV2FieldAnalysisCache(persisted);
    const second = new LexicalV2SearchIndex(sources, { fieldCache: warm });
    for (const query of queries) {
      expect(first.search(query)).toEqual(full.search(query));
      expect(second.search(query)).toEqual(full.search(query));
    }
    expect(warm.statistics.analyzedFields).toBe(0);
    expect(warm.snapshot()).toBeNull();
    expect(second.search("qzxvnjkqzvnmqjkx").hits).toEqual([]);

    const edited = [
      { ...sources[0]!, title: "Changed runtime contract", text: "recovery ".repeat(100) },
      sources[2]!,
    ];
    const incremental = new LexicalV2FieldAnalysisCache(persisted);
    const changed = new LexicalV2SearchIndex(edited, { fieldCache: incremental });
    const rebuilt = new LexicalV2SearchIndex(edited);
    for (const query of queries) expect(changed.search(query)).toEqual(rebuilt.search(query));
    expect(incremental.statistics.analyzedFields).toBe(2);
    const compacted = incremental.snapshot() as { entries: unknown[] };
    expect(compacted.entries.length).toBeLessThan(persisted.entries.length);
  });

  it("rebuilds malformed field data and incompatible builds from the current input", () => {
    const cold = new LexicalV2FieldAnalysisCache();
    const full = new LexicalV2SearchIndex(sources, { fieldCache: cold });
    const broken = structuredClone(cold.snapshot()) as {
      build: string;
      entries: Array<[string, [Map<string, number>, Map<string, number>]]>;
    };
    const frequencies = broken.entries[0]![1][0];
    frequencies.set(frequencies.keys().next().value!, 0);
    for (const snapshot of [broken, { ...broken, build: "old-analysis" }, { build: "invalid" }]) {
      const cache = new LexicalV2FieldAnalysisCache(snapshot);
      const recovered = new LexicalV2SearchIndex(sources, { fieldCache: cache });
      expect(recovered.search("runtime recovery")).toEqual(full.search("runtime recovery"));
      expect(cache.statistics.analyzedFields).toBeGreaterThan(0);
    }
  });
});
