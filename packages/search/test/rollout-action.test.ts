import { describe, expect, it } from "vitest";

import {
  assertSearchRolloutActionEligibility,
  createSearchAssessment,
  createSearchEngineActivationPolicy,
  createSearchRolloutActionPolicy,
  createSearchRolloutKeepAcknowledgement,
  createSearchRolloutQualitySnapshot,
  createSearchRolloutReview,
  createSearchRolloutReviewPolicy,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

function reviewPolicy() {
  return createSearchRolloutReviewPolicy({
    projectId: "prj_search_01",
    allowedReviewerIds: ["reviewer_rollout"],
    allowedCandidateIds: [rolloutTarget.candidateId],
    keepMinimumAssessedAttempts: 1,
    keepMaximumFailedAttempts: 0,
    rollbackMinimumAssessedAttempts: 2,
    rollbackMinimumFailedAttempts: 1,
    authoredBy: "reviewer_rollout",
    createdAt: new Date("2026-08-20T08:00:00.000Z"),
  });
}

describe("search rollout action", () => {
  it("records a keep acknowledgement only for an eligible unchanged current review", () => {
    const attempt = rolloutAttempt("a".repeat(32), "2026-08-20T08:01:00.000Z");
    const assessment = createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T08:02:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
    });
    const rolloutPolicy = reviewPolicy();
    const review = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [assessment],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T08:03:00.000Z"),
      decision: "keep_candidate",
      rolloutPolicyId: rolloutPolicy.policyId,
    });
    const actionPolicy = createSearchRolloutActionPolicy({
      rolloutPolicy,
      action: "acknowledge_keep",
      allowedOperatorIds: ["operator_search"],
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T08:04:00.000Z"),
    });
    const current = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [assessment],
      observedThrough: new Date("2026-08-20T08:05:00.000Z"),
    });
    const acknowledgement = createSearchRolloutKeepAcknowledgement({
      actionPolicy,
      rolloutPolicy,
      review,
      currentQualitySnapshot: current,
      currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
      operatorId: "operator_search",
      acknowledgedAt: new Date("2026-08-20T08:05:00.000Z"),
    });

    expect(acknowledgement).toMatchObject({
      action: "acknowledge_keep",
      rolloutReviewId: review.rolloutReviewId,
      qualityInputDigest: review.qualitySnapshot.inputDigest,
      recordState: "acknowledgement_recorded",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    const laterAttempt = rolloutAttempt("b".repeat(32), "2026-08-20T08:06:00.000Z");
    const changed = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt, laterAttempt],
      assessments: [assessment],
      observedThrough: new Date("2026-08-20T08:07:00.000Z"),
    });
    expect(() =>
      assertSearchRolloutActionEligibility({
        actionPolicy,
        rolloutPolicy,
        review,
        currentQualitySnapshot: changed,
        currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
        operatorId: "operator_search",
        actedAt: new Date("2026-08-20T08:07:00.000Z"),
      }),
    ).toThrow(/current quality input/);
  });

  it("uses a separate operator scope and engine policy for rollback actions", () => {
    const rolloutPolicy = reviewPolicy();
    const enginePolicy = createSearchEngineActivationPolicy({
      projectId: rolloutPolicy.projectId,
      allowedReviewerIds: ["reviewer_search"],
      allowedOperatorIds: ["operator_search"],
      allowedCandidateIds: [rolloutTarget.candidateId],
      minimumCandidateWins: 1,
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T08:01:00.000Z"),
    });
    const actionPolicy = createSearchRolloutActionPolicy({
      rolloutPolicy,
      engineActivationPolicy: enginePolicy,
      action: "execute_rollback",
      allowedOperatorIds: ["operator_search"],
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T08:02:00.000Z"),
    });

    expect(actionPolicy).toMatchObject({
      action: "execute_rollback",
      rolloutPolicyId: rolloutPolicy.policyId,
      engineActivationPolicyId: enginePolicy.policyId,
      allowedOperatorIds: ["operator_search"],
    });
    expect(() =>
      createSearchRolloutActionPolicy({
        rolloutPolicy,
        engineActivationPolicy: enginePolicy,
        action: "execute_rollback",
        allowedOperatorIds: ["operator_other"],
        authoredBy: "operator_other",
        createdAt: new Date("2026-08-20T08:02:00.000Z"),
      }),
    ).toThrow(/operator scope/);
  });
});
