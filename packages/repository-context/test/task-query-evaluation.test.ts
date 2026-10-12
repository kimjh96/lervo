import { describe, expect, it } from "vitest";
import { projectTaskQuery } from "@lervo/context";
import { LexicalV2SearchIndex } from "@lervo/search-adapter-lexical-v2";
import { sha256 } from "@lervo/repository-knowledge";
// Authored deterministic cases, not human-reviewed held-out or provider answer-quality evidence.
const cases = [
  { id: "performance", ko: "성능 지연 개선", en: "performance latency" },
  { id: "search", ko: "검색 품질 확인", en: "search retrieval" },
  { id: "cache", ko: "캐시 복구", en: "cache recovery" },
  { id: "rules", ko: "규칙 지침 확인", en: "instruction policy" },
  { id: "concurrency", ko: "동시 취소 처리", en: "concurrency cancellation" },
  { id: "release", ko: "배포 절차 확인", en: "release deployment" },
];
describe("local query projection authored retrieval conformance", () => {
  it("recovers bilingual task vocabulary with the same lexical engine and no model call", () => {
    const index = new LexicalV2SearchIndex(
      cases.map((item) => ({
        kind: "verified_knowledge" as const,
        sourceId: item.id,
        path: `${item.id}.md`,
        title: item.en,
        labels: [],
        text: item.en,
        contentHash: sha256(item.en),
      })),
    );
    for (const item of cases) {
      const projected = projectTaskQuery({ intent: item.ko, retrievalLanguages: ["en"] });
      expect(projected.providerCalls).toBe(0);
      expect(index.search(projected.query, 1).hits[0]?.source.sourceId).toBe(item.id);
      expect(
        index.search(projectTaskQuery({ intent: item.en }).query, 1).hits[0]?.source.sourceId,
      ).toBe(item.id);
      expect(index.search(item.ko, 1).hits).toHaveLength(0);
    }
  });
  it("keeps identifiers, target paths and publication language out of authority inference", () => {
    const projection = projectTaskQuery({
      intent: "ADR-0501 prj_abcdef 캐시",
      targetPaths: ["src/cache.ts"],
    });
    expect(projection.query).toContain("ADR-0501 prj_abcdef");
    expect(projection.query).toContain("src/cache.ts");
    expect(projection.query).toContain("cache");
    expect(projectTaskQuery({ intent: "진행해", continuation: "캐시 복구" }).query).toContain(
      "recovery",
    );
    expect(projectTaskQuery({ intent: "캐시", retrievalLanguages: ["ko"] }).query).not.toContain(
      "cache",
    );
  });
});
