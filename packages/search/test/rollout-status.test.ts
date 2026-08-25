import { describe, expect, it } from "vitest";

import {
  createSearchRolloutQualitySnapshot,
  createSearchRolloutReview,
  createSearchRolloutStatusPage,
  SEARCH_ENGINE,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

describe("search rollout status", () => {
  it("returns an empty bounded page for an implicit baseline", () => {
    const page = createSearchRolloutStatusPage({
      projectId: "prj_search_01",
      observedAt: new Date("2026-08-20T05:00:00.000Z"),
      currentSelection: {
        selectionTransitionId: null,
        selectionState: "implicit_baseline",
        candidateId: null,
        engine: SEARCH_ENGINE,
        adapterBuildId: null,
        candidateReviewId: null,
        buildEvidenceState: "not_applicable",
      },
      evidence: [],
    });

    expect(page).toMatchObject({
      reviewCount: 0,
      pageLimit: 20,
      reviews: [],
      nextCursor: null,
      reviewDecisionSelection: "not_performed",
    });
  });

  it("pages reviews stably and reports changed inputs without selecting a decision", () => {
    const first = rolloutAttempt("5".repeat(32), "2026-08-20T06:00:00.000Z");
    const firstReview = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [first],
      assessments: [],
      reviewerId: "reviewer_first",
      reviewedAt: new Date("2026-08-20T06:01:00.000Z"),
      decision: "keep_candidate",
    });
    const secondReview = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [first],
      assessments: [],
      reviewerId: "reviewer_second",
      reviewedAt: new Date("2026-08-20T06:02:00.000Z"),
      decision: "more_assessments_required",
    });
    const observedAt = new Date("2026-08-20T06:03:00.000Z");
    const unchanged = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [first],
      assessments: [],
      observedThrough: observedAt,
    });
    const input = {
      projectId: "prj_search_01",
      observedAt,
      currentSelection: {
        selectionTransitionId: rolloutTarget.selectionTransitionId,
        selectionState: "candidate" as const,
        candidateId: rolloutTarget.candidateId,
        engine: rolloutTarget.engine,
        adapterBuildId: rolloutTarget.adapterBuildId,
        candidateReviewId: rolloutTarget.candidateReviewId,
        buildEvidenceState: "bound" as const,
      },
      evidence: [
        { review: firstReview, currentQualitySnapshot: unchanged },
        { review: secondReview, currentQualitySnapshot: unchanged },
      ],
    };
    const firstPage = createSearchRolloutStatusPage({ ...input, limit: 1 });

    expect(firstPage).toMatchObject({
      schemaVersion: 1,
      reviewCount: 2,
      pageLimit: 1,
      reviews: [
        {
          review: { rolloutReviewId: secondReview.rolloutReviewId },
          qualityInputState: "unchanged",
          selectionRelation: "current_selection",
        },
      ],
      nextCursor: secondReview.rolloutReviewId,
      reviewDecisionSelection: "not_performed",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    const secondPage = createSearchRolloutStatusPage({
      ...input,
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.reviews[0]!.review.rolloutReviewId).toBe(firstReview.rolloutReviewId);
    expect(secondPage.nextCursor).toBeNull();

    const later = rolloutAttempt("6".repeat(32), "2026-08-20T06:02:30.000Z");
    const changed = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [first, later],
      assessments: [],
      observedThrough: observedAt,
    });
    const afterChange = createSearchRolloutStatusPage({
      ...input,
      evidence: [{ review: firstReview, currentQualitySnapshot: changed }],
    });
    expect(afterChange.reviews[0]).toMatchObject({
      qualityInputState: "changed",
      currentQualitySnapshot: { totalAttempts: 2 },
    });
    expect(() =>
      createSearchRolloutStatusPage({ ...input, cursor: `srrv_${"f".repeat(24)}` }),
    ).toThrow(/cursor/);
    expect(() => createSearchRolloutStatusPage({ ...input, limit: 51 })).toThrow(/query input/);
  });

  it("shows past reviews beside a current rollback baseline without changing their meaning", () => {
    const attempt = rolloutAttempt("7".repeat(32), "2026-08-20T07:00:00.000Z");
    const review = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T07:01:00.000Z"),
      decision: "rollback_recommended",
    });
    const observedAt = new Date("2026-08-20T07:02:00.000Z");
    const snapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [],
      observedThrough: observedAt,
    });
    const page = createSearchRolloutStatusPage({
      projectId: "prj_search_01",
      observedAt,
      currentSelection: {
        selectionTransitionId: `seact_${"e".repeat(24)}`,
        selectionState: "recorded_baseline",
        candidateId: null,
        engine: SEARCH_ENGINE,
        adapterBuildId: null,
        candidateReviewId: null,
        buildEvidenceState: "not_applicable",
      },
      evidence: [{ review, currentQualitySnapshot: snapshot }],
    });

    expect(page.reviews[0]).toMatchObject({
      review: { decision: "rollback_recommended", effect: { rollback: "not_executed" } },
      selectionRelation: "historical_selection",
      qualityInputState: "unchanged",
    });
    expect(page.currentSelection.selectionState).toBe("recorded_baseline");
  });
});
