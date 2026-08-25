import { describe, expect, it } from "vitest";

import {
  createSearchAssessment,
  createSearchRolloutActionPolicy,
  createSearchRolloutActionPreflight,
  createSearchRolloutQualitySnapshot,
  createSearchRolloutReview,
  createSearchRolloutReviewPolicy,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

function keepFixture() {
  const attempt = rolloutAttempt("c".repeat(32), "2026-08-20T11:00:00.000Z");
  const assessment = createSearchAssessment({
    attempt,
    assessedAt: new Date("2026-08-20T11:01:00.000Z"),
    assessor: "human",
    outcome: "accepted",
    selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
  });
  const rolloutPolicy = createSearchRolloutReviewPolicy({
    projectId: "prj_search_01",
    allowedReviewerIds: ["reviewer_rollout"],
    allowedCandidateIds: [rolloutTarget.candidateId],
    keepMinimumAssessedAttempts: 1,
    keepMaximumFailedAttempts: 0,
    rollbackMinimumAssessedAttempts: 2,
    rollbackMinimumFailedAttempts: 1,
    authoredBy: "reviewer_rollout",
    createdAt: new Date("2026-08-20T10:59:00.000Z"),
  });
  const review = createSearchRolloutReview({
    projectId: "prj_search_01",
    target: rolloutTarget,
    attempts: [attempt],
    assessments: [assessment],
    reviewerId: "reviewer_rollout",
    reviewedAt: new Date("2026-08-20T11:02:00.000Z"),
    decision: "keep_candidate",
    rolloutPolicyId: rolloutPolicy.policyId,
  });
  const actionPolicy = createSearchRolloutActionPolicy({
    rolloutPolicy,
    action: "acknowledge_keep",
    allowedOperatorIds: ["operator_search"],
    authoredBy: "operator_search",
    createdAt: new Date("2026-08-20T11:03:00.000Z"),
  });
  return { attempt, assessment, rolloutPolicy, review, actionPolicy };
}

describe("search rollout action preflight", () => {
  it("reports an eligible exact keep request without recording an action", () => {
    const fixture = keepFixture();
    const checkedAt = new Date("2026-08-20T11:04:00.000Z");
    const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [fixture.attempt],
      assessments: [fixture.assessment],
      observedThrough: checkedAt,
    });

    expect(
      createSearchRolloutActionPreflight({
        actionPolicy: fixture.actionPolicy,
        rolloutPolicy: fixture.rolloutPolicy,
        review: fixture.review,
        currentQualitySnapshot,
        currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
        requestedAction: "acknowledge_keep",
        operatorId: "operator_search",
        checkedAt,
      }),
    ).toMatchObject({
      eligibility: "eligible",
      failureReasons: [],
      qualityInputState: "unchanged",
      actionSelection: "not_performed",
      effect: {
        acknowledgement: "not_recorded",
        selectionChange: "not_applied",
        rollback: "not_executed",
        approval: "not_granted",
      },
    });
  });

  it("returns stable reasons for changed input, a past selection, and an unauthorized operator", () => {
    const fixture = keepFixture();
    const laterAttempt = rolloutAttempt("d".repeat(32), "2026-08-20T11:04:00.000Z");
    const checkedAt = new Date("2026-08-20T11:05:00.000Z");
    const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [fixture.attempt, laterAttempt],
      assessments: [fixture.assessment],
      observedThrough: checkedAt,
    });
    const result = createSearchRolloutActionPreflight({
      actionPolicy: fixture.actionPolicy,
      rolloutPolicy: fixture.rolloutPolicy,
      review: fixture.review,
      currentQualitySnapshot,
      currentSelectionTransitionId: null,
      requestedAction: "acknowledge_keep",
      operatorId: "operator_other",
      checkedAt,
    });

    expect(result).toMatchObject({
      eligibility: "ineligible",
      qualityInputState: "changed",
      failureReasons: ["operator_not_allowed", "selection_not_current", "quality_input_changed"],
    });
  });

  it("separates a requested action mismatch from the recorded review decision", () => {
    const fixture = keepFixture();
    const checkedAt = new Date("2026-08-20T11:04:00.000Z");
    const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [fixture.attempt],
      assessments: [fixture.assessment],
      observedThrough: checkedAt,
    });
    const result = createSearchRolloutActionPreflight({
      actionPolicy: fixture.actionPolicy,
      rolloutPolicy: fixture.rolloutPolicy,
      review: fixture.review,
      currentQualitySnapshot,
      currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
      requestedAction: "execute_rollback",
      operatorId: "operator_search",
      checkedAt,
    });

    expect(result.failureReasons).toEqual([
      "requested_action_mismatch",
      "review_decision_mismatch",
    ]);
    expect(result.eligibility).toBe("ineligible");
  });
});
