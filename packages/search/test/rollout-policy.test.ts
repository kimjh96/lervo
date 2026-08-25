import { describe, expect, it } from "vitest";

import {
  createSearchAssessment,
  createSearchRolloutReview,
  createSearchRolloutReviewPolicy,
  evaluateSearchRolloutReviewPolicy,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

function policy() {
  return createSearchRolloutReviewPolicy({
    projectId: "prj_search_01",
    allowedReviewerIds: ["reviewer_rollout"],
    allowedCandidateIds: [rolloutTarget.candidateId],
    keepMinimumAssessedAttempts: 1,
    keepMaximumFailedAttempts: 0,
    rollbackMinimumAssessedAttempts: 1,
    rollbackMinimumFailedAttempts: 1,
    authoredBy: "reviewer_rollout",
    createdAt: new Date("2026-08-20T08:00:00.000Z"),
  });
}

describe("search rollout review policy", () => {
  it("keeps legacy reviews unbound and evaluates only the explicitly bound decision", () => {
    const attempt = rolloutAttempt("8".repeat(32), "2026-08-20T08:01:00.000Z");
    const assessment = createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T08:02:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
    });
    const rolloutPolicy = policy();
    const legacy = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [assessment],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T08:03:00.000Z"),
      decision: "keep_candidate",
    });
    const bound = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [assessment],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T08:03:00.000Z"),
      decision: "keep_candidate",
      rolloutPolicyId: rolloutPolicy.policyId,
    });

    expect(evaluateSearchRolloutReviewPolicy(rolloutPolicy, legacy)).toMatchObject({
      policyBindingState: "legacy_unbound",
      reviewDecisionEligibility: "ineligible",
      failureReasons: ["policy_not_bound"],
    });
    expect(evaluateSearchRolloutReviewPolicy(rolloutPolicy, bound)).toMatchObject({
      policyBindingState: "bound",
      ruleOutcomes: {
        keepCandidate: "eligible",
        rollbackRecommended: "ineligible",
        moreAssessmentsRequired: "eligible",
      },
      reviewDecisionEligibility: "eligible",
      failureReasons: [],
      decisionSelection: "not_performed",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    expect(legacy.thresholdPolicyState).toBe("not_defined");
    expect(bound.thresholdPolicyState).toBe("bound");
  });

  it("uses separate non-overlapping failure rules without choosing a decision", () => {
    const attempt = rolloutAttempt("9".repeat(32), "2026-08-20T09:01:00.000Z");
    const failed = createSearchAssessment({
      attempt,
      assessedAt: new Date("2026-08-20T09:02:00.000Z"),
      assessor: "human",
      outcome: "failed",
      failureReason: "results_not_relevant",
    });
    const rolloutPolicy = policy();
    const rollback = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [attempt],
      assessments: [failed],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T09:03:00.000Z"),
      decision: "rollback_recommended",
      rolloutPolicyId: rolloutPolicy.policyId,
    });

    expect(evaluateSearchRolloutReviewPolicy(rolloutPolicy, rollback)).toMatchObject({
      ruleOutcomes: {
        keepCandidate: "ineligible",
        rollbackRecommended: "eligible",
        moreAssessmentsRequired: "eligible",
      },
      reviewDecisionEligibility: "eligible",
      decisionSelection: "not_performed",
    });
    expect(() =>
      createSearchRolloutReviewPolicy({
        projectId: "prj_search_01",
        allowedReviewerIds: ["reviewer_rollout"],
        allowedCandidateIds: [rolloutTarget.candidateId],
        keepMinimumAssessedAttempts: 1,
        keepMaximumFailedAttempts: 1,
        rollbackMinimumAssessedAttempts: 1,
        rollbackMinimumFailedAttempts: 1,
        authoredBy: "reviewer_rollout",
        createdAt: new Date("2026-08-20T09:00:00.000Z"),
      }),
    ).toThrow(/decision criteria/);
  });
});
