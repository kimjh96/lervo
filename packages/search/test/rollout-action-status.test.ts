import { describe, expect, it } from "vitest";

import {
  createSearchAssessment,
  createSearchRolloutActionPolicy,
  createSearchRolloutActionStatusPage,
  createSearchRolloutKeepAcknowledgement,
  createSearchRolloutQualitySnapshot,
  createSearchRolloutReview,
  createSearchRolloutReviewPolicy,
} from "../src/index.js";
import { rolloutAttempt, rolloutTarget } from "./rollout-review-fixture.js";

function keepEvidence() {
  const attempt = rolloutAttempt("8".repeat(32), "2026-08-20T08:00:00.000Z");
  const assessment = createSearchAssessment({
    attempt,
    assessedAt: new Date("2026-08-20T08:01:00.000Z"),
    assessor: "human",
    outcome: "accepted",
    selectedSources: [{ sourceKind: "document", sourceId: "doc_rollout_01" }],
  });
  const rolloutPolicy = createSearchRolloutReviewPolicy({
    projectId: "prj_search_01",
    allowedReviewerIds: ["reviewer_rollout"],
    allowedCandidateIds: ["fixture-v1"],
    keepMinimumAssessedAttempts: 1,
    keepMaximumFailedAttempts: 0,
    rollbackMinimumAssessedAttempts: 2,
    rollbackMinimumFailedAttempts: 1,
    authoredBy: "reviewer_rollout",
    createdAt: new Date("2026-08-20T07:58:00.000Z"),
  });
  const review = createSearchRolloutReview({
    projectId: "prj_search_01",
    target: rolloutTarget,
    attempts: [attempt],
    assessments: [assessment],
    reviewerId: "reviewer_rollout",
    reviewedAt: new Date("2026-08-20T08:02:00.000Z"),
    decision: "keep_candidate",
    rolloutPolicyId: rolloutPolicy.policyId,
  });
  const actionPolicy = createSearchRolloutActionPolicy({
    rolloutPolicy,
    action: "acknowledge_keep",
    allowedOperatorIds: ["operator_one", "operator_two"],
    authoredBy: "operator_one",
    createdAt: new Date("2026-08-20T08:02:30.000Z"),
  });
  return { attempt, assessment, rolloutPolicy, review, actionPolicy };
}

describe("search rollout action status", () => {
  it("pages verified actions without choosing or applying one", () => {
    const evidence = keepEvidence();
    const firstSnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
      observedThrough: new Date("2026-08-20T08:03:00.000Z"),
    });
    const first = createSearchRolloutKeepAcknowledgement({
      actionPolicy: evidence.actionPolicy,
      rolloutPolicy: evidence.rolloutPolicy,
      review: evidence.review,
      currentQualitySnapshot: firstSnapshot,
      currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
      operatorId: "operator_one",
      acknowledgedAt: new Date("2026-08-20T08:03:00.000Z"),
    });
    const secondSnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
      observedThrough: new Date("2026-08-20T08:04:00.000Z"),
    });
    const second = createSearchRolloutKeepAcknowledgement({
      actionPolicy: evidence.actionPolicy,
      rolloutPolicy: evidence.rolloutPolicy,
      review: evidence.review,
      currentQualitySnapshot: secondSnapshot,
      currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
      operatorId: "operator_two",
      acknowledgedAt: new Date("2026-08-20T08:04:00.000Z"),
    });
    const observedAt = new Date("2026-08-20T08:05:00.000Z");
    const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
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
        { record: first, review: evidence.review, currentQualitySnapshot },
        { record: second, review: evidence.review, currentQualitySnapshot },
      ],
    };
    const page = createSearchRolloutActionStatusPage({ ...input, limit: 1 });

    expect(page).toMatchObject({
      actionCount: 2,
      pageLimit: 1,
      actions: [{
        actionId: second.acknowledgementId,
        action: "acknowledge_keep",
        qualityInputState: "unchanged",
        reviewSelectionRelation: "current_selection",
        actionTransitionRelation: "not_applicable",
      }],
      nextCursor: second.acknowledgementId,
      actionSelection: "not_performed",
      effect: { selectionChange: "not_applied", rollback: "not_executed", approval: "not_granted" },
    });
    const next = createSearchRolloutActionStatusPage({
      ...input,
      limit: 1,
      cursor: page.nextCursor!,
    });
    expect(next.actions[0]!.actionId).toBe(first.acknowledgementId);
    expect(next.nextCursor).toBeNull();
    expect(() => createSearchRolloutActionStatusPage({
      ...input,
      cursor: `srack_${"f".repeat(24)}`,
    })).toThrow(/cursor/);
  });

  it("rejects a structurally valid action that is detached from its review evidence", () => {
    const evidence = keepEvidence();
    const actedAt = new Date("2026-08-20T08:03:00.000Z");
    const snapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
      observedThrough: actedAt,
    });
    const acknowledgement = createSearchRolloutKeepAcknowledgement({
      actionPolicy: evidence.actionPolicy,
      rolloutPolicy: evidence.rolloutPolicy,
      review: evidence.review,
      currentQualitySnapshot: snapshot,
      currentSelectionTransitionId: rolloutTarget.selectionTransitionId,
      operatorId: "operator_one",
      acknowledgedAt: actedAt,
    });
    const otherReview = createSearchRolloutReview({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
      reviewerId: "reviewer_rollout",
      reviewedAt: new Date("2026-08-20T08:02:30.000Z"),
      decision: "keep_candidate",
      rolloutPolicyId: evidence.rolloutPolicy.policyId,
    });
    const observedAt = new Date("2026-08-20T08:04:00.000Z");
    const currentQualitySnapshot = createSearchRolloutQualitySnapshot({
      projectId: "prj_search_01",
      target: rolloutTarget,
      attempts: [evidence.attempt],
      assessments: [evidence.assessment],
      observedThrough: observedAt,
    });

    expect(() => createSearchRolloutActionStatusPage({
      projectId: "prj_search_01",
      observedAt,
      currentSelection: {
        selectionTransitionId: rolloutTarget.selectionTransitionId,
        selectionState: "candidate",
        candidateId: rolloutTarget.candidateId,
        engine: rolloutTarget.engine,
        adapterBuildId: rolloutTarget.adapterBuildId,
        candidateReviewId: rolloutTarget.candidateReviewId,
        buildEvidenceState: "bound",
      },
      evidence: [{ record: acknowledgement, review: otherReview, currentQualitySnapshot }],
    })).toThrow(/근거 관계/);
  });
});
