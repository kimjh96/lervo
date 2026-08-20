import { describe, expect, it } from "vitest";

import {
  createSearchAssessment,
  createSearchAttempt,
  createSearchQualityReport,
  LexicalSearchIndex,
  type SearchSourceInput,
} from "../src/index.js";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function sources(): SearchSourceInput[] {
  return [
    {
      kind: "document",
      sourceId: "doc_runtime_01",
      path: "docs/runtime.md",
      contentHash: HASH_A,
      title: "실행 상태와 복구",
      labels: ["runtime"],
      text: "중단된 실행은 원본 이벤트에서 복구합니다.",
    },
    {
      kind: "document",
      sourceId: "doc_lifecycle_01",
      path: "docs/document-lifecycle.md",
      contentHash: HASH_B,
      title: "문서 수명주기",
      labels: ["canonical", "documents"],
      text: "문서를 주제별로 나누고 노후화 상태를 검증합니다.",
    },
  ];
}

describe("deterministic lexical search baseline", () => {
  it("ranks exact title and path evidence without returning source text", () => {
    const result = new LexicalSearchIndex(sources()).search("문서 수명주기", 10);

    expect(result.hits[0]).toMatchObject({
      source: { sourceId: "doc_lifecycle_01", path: "docs/document-lifecycle.md" },
      rank: 1,
      matchedFields: expect.arrayContaining(["title", "text"]),
    });
    expect(JSON.stringify(result)).not.toContain("주제별로 나누고");
  });

  it("produces the same index and ranking regardless of corpus input order", () => {
    const forward = new LexicalSearchIndex(sources());
    const reversed = new LexicalSearchIndex(sources().reverse());

    expect(reversed.indexId).toBe(forward.indexId);
    expect(reversed.search("복구")).toEqual(forward.search("복구"));
  });

  it("changes the derived index identity when an original content hash changes", () => {
    const changed = sources();
    changed[0] = { ...changed[0]!, contentHash: `sha256:${"c".repeat(64)}` };

    expect(new LexicalSearchIndex(changed).indexId).not.toBe(new LexicalSearchIndex(sources()).indexId);
  });

  it("binds ranking metadata and searchable text to the index identity", () => {
    const changed = sources();
    changed[0] = { ...changed[0]!, title: "다른 제목", labels: ["changed"] };

    expect(new LexicalSearchIndex(changed).indexId).not.toBe(new LexicalSearchIndex(sources()).indexId);
  });

  it("records only a query digest and bounded result coordinates", () => {
    const response = new LexicalSearchIndex(sources()).search("복구 방법");
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "1".repeat(32),
      response,
    });

    expect(JSON.stringify(attempt)).not.toContain("복구 방법");
    expect(attempt.hits[0]).not.toHaveProperty("path");
  });

  it("requires explicit assessment and never turns failures into an embedding decision", () => {
    const acceptedResponse = new LexicalSearchIndex(sources()).search("복구");
    const acceptedAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "2".repeat(32),
      response: acceptedResponse,
    });
    const failedAttempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:01.000Z"),
      nonce: "3".repeat(32),
      response: new LexicalSearchIndex(sources()).search("양자역학"),
    });
    const assessments = [
      createSearchAssessment({
        attempt: acceptedAttempt,
        assessedAt: new Date("2026-08-20T04:01:00.000Z"),
        assessor: "human",
        outcome: "accepted",
        selectedSources: [{
          sourceKind: acceptedAttempt.hits[0]!.sourceKind,
          sourceId: acceptedAttempt.hits[0]!.sourceId,
        }],
      }),
      createSearchAssessment({
        attempt: failedAttempt,
        assessedAt: new Date("2026-08-20T04:01:01.000Z"),
        assessor: "human",
        outcome: "failed",
        failureReason: "no_results",
      }),
    ];

    expect(createSearchQualityReport([acceptedAttempt, failedAttempt], assessments)).toMatchObject({
      assessedAttempts: 2,
      acceptedAttempts: 1,
      failedAttempts: 1,
      failuresByReason: { no_results: 1 },
      evidenceState: "failures_observed",
      embeddingDecision: "not_determined",
    });
  });

  it("rejects an unsafe repository path and an unbounded query", () => {
    expect(() => new LexicalSearchIndex([{ ...sources()[0]!, path: "../secret.md" }]))
      .toThrow(/source 좌표/);
    expect(() => new LexicalSearchIndex(sources()).search("단어 ".repeat(33)))
      .toThrow(/32개/);
  });

  it("does not accept no_results as a label when the attempt returned a result", () => {
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "4".repeat(32),
      response: new LexicalSearchIndex(sources()).search("복구"),
    });

    expect(() => createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T04:01:00.000Z"),
      assessor: "human",
      outcome: "failed",
      failureReason: "no_results",
    })).toThrow(/대상 시도/);
  });

  it("keeps source kind in assessment coordinates when IDs overlap", () => {
    const attempt = createSearchAttempt({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T04:00:00.000Z"),
      nonce: "5".repeat(32),
      response: new LexicalSearchIndex(sources()).search("복구"),
    });

    expect(() => createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T04:01:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{ sourceKind: "skill", sourceId: attempt.hits[0]!.sourceId }],
    })).toThrow(/대상 시도/);
  });
});
