import { describe, expect, it } from "vitest";

import {
  assertSearchRolloutReview,
  createSearchAssessment,
  createSearchRolloutReview,
  verifySearchRolloutReview,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

describe("search rollout review", () => {
  it("binds a human decision to an exact quality snapshot without applying it", () => {
    const first = rolloutAttempt("1".repeat(32), "2026-08-20T04:00:00.000Z");
    const second = rolloutAttempt("2".repeat(32), "2026-08-20T04:01:00.000Z");
    const assessment = createSearchAssessment({
      attempt: first,
      assessedAt: new Date("2026-08-20T04:02:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
    });
    const input = {
      projectId: "prj_search_01",
      target: rolloutTarget,
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
      target: rolloutTarget,
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
    expect(JSON.stringify(review)).not.toContain("review result");
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
    expect(() => assertSearchRolloutReview(tampered)).toThrow(/snapshot|actual content/);
  });

  it("does not silently widen a recorded snapshot when later evidence appears", () => {
    const first = rolloutAttempt("3".repeat(32), "2026-08-20T05:00:00.000Z");
    const review = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [first],
      assessments: [],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T05:01:00.000Z"),
      decision: "more_assessments_required",
    });
    const later = rolloutAttempt("4".repeat(32), "2026-08-20T05:00:30.000Z");

    expect(() =>
      verifySearchRolloutReview(review, {
        attempts: [first, later],
        assessments: [],
      }),
    ).toThrow(/source quality input/);
    expect(() =>
      createSearchRolloutReview({
        projectId: "prj_search_01",
        target: { ...rolloutTarget, selectionTransitionId: `seact_${"d".repeat(24)}` },
        attempts: [first],
        assessments: [],
        reviewerId: "reviewer_rollout",
        reviewedAt: new Date("2026-08-20T05:01:00.000Z"),
        decision: "rollback_recommended",
      }),
    ).toThrow(/target selection or timestamp/);
  });
});
