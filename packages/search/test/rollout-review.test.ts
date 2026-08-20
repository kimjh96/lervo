import { describe, expect, it } from "vitest";

import {
  assertSearchRolloutReview,
  contentId,
  createSearchAssessment,
  createSearchAttempt,
  createSearchRolloutReview,
  LexicalSearchIndex,
  verifySearchRolloutReview,
  type SearchAttempt,
  type SearchRolloutReviewTarget,
  type SearchSourceInput,
} from "../src/index.js";

const sources: SearchSourceInput[] = [{
  kind: "document",
  sourceId: "doc_rollout_01",
  contentHash: `sha256:${"a".repeat(64)}`,
  labels: ["rollout"],
  text: "검토할 검색 결과입니다.",
}];
const target: SearchRolloutReviewTarget = {
  selectionTransitionId: `seact_${"b".repeat(24)}`,
  candidateId: "fixture-v1",
  engine: { id: "fixture_candidate", version: 1 },
  adapterBuildId: contentId("sebuild", { adapter: "fixture_candidate", revision: 1 }),
  candidateReviewId: `scrv_${"c".repeat(24)}`,
};

function attempt(nonce: string, observedAt: string): SearchAttempt {
  return createSearchAttempt({
    projectId: "prj_search_01",
    observedAt: new Date(observedAt),
    nonce,
    response: {
      ...new LexicalSearchIndex(sources).search("검토 결과"),
      engine: target.engine,
    },
    selectionTransitionId: target.selectionTransitionId,
  });
}

describe("search rollout review", () => {
  it("binds a human decision to an exact quality snapshot without applying it", () => {
    const first = attempt("1".repeat(32), "2026-08-20T04:00:00.000Z");
    const second = attempt("2".repeat(32), "2026-08-20T04:01:00.000Z");
    const assessment = createSearchAssessment({
      attempt: first,
      assessedAt: new Date("2026-08-20T04:02:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
    });
    const input = {
      projectId: "prj_search_01",
      target,
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T04:03:00.000Z"),
      decision: "keep_candidate" as const,
    };
    const review = createSearchRolloutReview({
      ...input,
      attempts: [second, first],
      assessments: [assessment],
    });
    const reordered = createSearchRolloutReview({
      ...input,
      attempts: [first, second],
      assessments: [assessment],
    });

    expect(reordered).toEqual(review);
    expect(review).toMatchObject({
      schemaVersion: 1,
      rolloutReviewId: expect.stringMatching(/^srrv_[a-f0-9]{24}$/),
      target,
      qualitySnapshot: {
        snapshotId: expect.stringMatching(/^srqs_[a-f0-9]{24}$/),
        totalAttempts: 2,
        assessedAttempts: 1,
        unassessedAttempts: 1,
        acceptedAttempts: 1,
        failedAttempts: 0,
        evidenceState: "no_failures_observed",
      },
      decision: "keep_candidate",
      thresholdPolicyState: "not_defined",
      effect: {
        selectionChange: "not_applied",
        rollback: "not_executed",
        approval: "not_granted",
      },
      embeddingDecision: "not_determined",
    });
    expect(JSON.stringify(review)).not.toContain("검토 결과");
    assertSearchRolloutReview(review);
    verifySearchRolloutReview(review, { attempts: [first, second], assessments: [assessment] });

    const rollbackRecommendation = createSearchRolloutReview({
      ...input,
      attempts: [first, second],
      assessments: [assessment],
      decision: "rollback_recommended",
    });
    expect(rollbackRecommendation).toMatchObject({
      decision: "rollback_recommended",
      thresholdPolicyState: "not_defined",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    expect(rollbackRecommendation.rolloutReviewId).not.toBe(review.rolloutReviewId);

    const tampered = structuredClone(review);
    tampered.qualitySnapshot.acceptedAttempts = 0;
    expect(() => assertSearchRolloutReview(tampered)).toThrow(/snapshot|실제 내용/);
  });

  it("does not silently widen a recorded snapshot when later evidence appears", () => {
    const first = attempt("3".repeat(32), "2026-08-20T05:00:00.000Z");
    const review = createSearchRolloutReview({
      projectId: "prj_search_01",
      target,
      attempts: [first],
      assessments: [],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T05:01:00.000Z"),
      decision: "more_assessments_required",
    });
    const later = attempt("4".repeat(32), "2026-08-20T05:00:30.000Z");

    expect(() => verifySearchRolloutReview(review, {
      attempts: [first, later],
      assessments: [],
    })).toThrow(/원본 품질 입력/);
    expect(() => createSearchRolloutReview({
      projectId: "prj_search_01",
      target: { ...target, selectionTransitionId: `seact_${"d".repeat(24)}` },
      attempts: [first],
      assessments: [],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T05:01:00.000Z"),
      decision: "rollback_recommended",
    })).toThrow(/대상 선택/);
  });
});
