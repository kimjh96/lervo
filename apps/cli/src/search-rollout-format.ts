import type {
  SearchRolloutReview,
  SearchRolloutReviewDecision,
  SearchRolloutPolicyAssessment,
  SearchEngineRolloutRollback,
  SearchRolloutActionPolicy,
  SearchRolloutActionPreflight,
  SearchRolloutKeepAcknowledgement,
  SearchRolloutActionStatusPage,
  SearchRolloutReviewPolicy,
  SearchRolloutStatusPage,
} from "@lervo/search";

function decisionLabel(decision: SearchRolloutReviewDecision): string {
  if (decision === "keep_candidate") return "keep candidate";
  if (decision === "rollback_recommended") return "rollback recommended";
  return "more assessments required";
}

export function formatSearchRolloutActionPolicy(policy: SearchRolloutActionPolicy): string {
  return (
    [
      `Search rollout action policy created: ${policy.actionPolicyId}`,
      `  Action: ${policy.action === "acknowledge_keep" ? "acknowledge keep" : "execute rollback"}`,
      `  Allowed operators ${policy.allowedOperatorIds.length} · review policy ${policy.rolloutPolicyId}`,
      `  Engine policy: ${policy.engineActivationPolicyId ?? "not used"}`,
      `  File: .lervo/search-rollout-action-policies/${policy.actionPolicyId}.yaml`,
    ].join("\n") + "\n"
  );
}

export function formatSearchRolloutActionResult(
  result: SearchRolloutKeepAcknowledgement | SearchEngineRolloutRollback,
): string {
  if (result.schemaVersion === 1) {
    return (
      [
        `Search candidate keep acknowledgement recorded: ${result.acknowledgementId}`,
        `  Rollout review: ${result.rolloutReviewId}`,
        `  operator: ${result.operatorId}`,
        "  The current search engine selection was not changed, and this record is not an approval.",
      ].join("\n") + "\n"
    );
  }
  return (
    [
      `Search rollout rollback recorded: ${result.activationId}`,
      `  Rollout review: ${result.rolloutAction.rolloutReviewId}`,
      `  ${result.previousSelection.engine.id}-v${result.previousSelection.engine.version}` +
        ` → ${result.selected.engine.id}-v${result.selected.engine.version}`,
      `  Operator: ${result.operatorId} · selection transition ${result.sequence}`,
      "  The review, action policy, and checked quality input are recorded with this rollback transition.",
    ].join("\n") + "\n"
  );
}

export function formatSearchRolloutActionStatus(status: SearchRolloutActionStatusPage): string {
  const selection =
    status.currentSelection.selectionState === "implicit_baseline"
      ? "default lexical selection without a transition"
      : status.currentSelection.selectionState === "recorded_baseline"
        ? `recorded baseline · ${status.currentSelection.selectionTransitionId}`
        : `${status.currentSelection.engine.id}-v${status.currentSelection.engine.version}` +
          ` · ${status.currentSelection.selectionTransitionId}`;
  return (
    [
      "Search rollout action status:",
      `  Current selection: ${selection}`,
      `  Action sources ${status.actionCount} · this page ${status.actions.length}`,
      ...status.actions.flatMap((item) => [
        `  ${item.actionId} · ${item.action === "acknowledge_keep" ? "acknowledge keep" : "execute rollback"}`,
        `    Review ${item.review.rolloutReviewId} · quality input ${
          item.qualityInputState === "unchanged" ? "unchanged" : "changed"
        }`,
        `    Review target ${item.reviewSelectionRelation === "current_selection" ? "current selection" : "historical selection"}` +
          (item.actionTransitionRelation === "not_applicable"
            ? " · no separate selection transition"
            : ` · rollback result ${
                item.actionTransitionRelation === "current_selection"
                  ? "current selection"
                  : "historical selection"
              }`),
      ]),
      status.nextCursor === null ? "  No next page" : `  Next cursor: ${status.nextCursor}`,
      "  This query does not choose an action automatically or execute a rollback or approval.",
    ].join("\n") + "\n"
  );
}

const preflightFailureLabels: Record<
  SearchRolloutActionPreflight["failureReasons"][number],
  string
> = {
  requested_action_mismatch: "requested action differs from policy action",
  action_policy_not_active: "action policy is not active yet",
  review_not_active: "review time has not arrived",
  review_policy_not_bound: "review is not bound to a policy",
  review_policy_mismatch: "review is bound to a different policy",
  review_decision_mismatch: "review decision differs from requested action",
  review_policy_not_eligible: "review decision does not satisfy policy",
  operator_not_allowed: "action policy does not allow the operator",
  engine_operator_not_allowed: "engine policy does not allow the operator",
  selection_not_current: "review target is not the current selection",
  quality_input_changed: "quality input changed after review",
};

export function formatSearchRolloutActionPreflight(result: SearchRolloutActionPreflight): string {
  const reasons =
    result.failureReasons.length === 0
      ? "none"
      : result.failureReasons.map((reason) => preflightFailureLabels[reason]).join(", ");
  return (
    [
      `Search rollout action preflight: ${result.rolloutReviewId}`,
      `  Requested action: ${result.requestedAction === "acknowledge_keep" ? "acknowledge keep" : "execute rollback"}`,
      `  Eligible: ${result.eligibility === "eligible" ? "yes" : "no"}`,
      `  Quality input: ${result.qualityInputState === "unchanged" ? "unchanged" : "changed"}`,
      `  Unsatisfied reasons: ${reasons}`,
      "  This check does not acknowledge a keep, change a selection, execute a rollback, or grant approval.",
    ].join("\n") + "\n"
  );
}

export function formatSearchRolloutReview(review: SearchRolloutReview): string {
  const lines = [
    `Search rollout review recorded: ${review.rolloutReviewId}`,
    `  Decision: ${decisionLabel(review.decision)}`,
    `  Governing policy: ${review.schemaVersion === 2 ? review.rolloutPolicyId : "not bound (legacy)"}`,
    `  Evidence: attempts ${review.qualitySnapshot.totalAttempts} · assessed ${review.qualitySnapshot.assessedAttempts}` +
      ` · failed ${review.qualitySnapshot.failedAttempts}`,
    "  This record does not grant approval or change the search engine.",
  ];
  return `${lines.join("\n")}\n`;
}

export function formatSearchRolloutPolicy(policy: SearchRolloutReviewPolicy): string {
  return (
    [
      `Search rollout review policy created: ${policy.policyId}`,
      `  Allowed reviewers ${policy.allowedReviewerIds.length} · candidates ${policy.allowedCandidateIds.join(", ")}`,
      `  Keep candidate: at least ${policy.rules.keepCandidate.minimumAssessedAttempts} assessed` +
        ` · at most ${policy.rules.keepCandidate.maximumFailedAttempts} failed`,
      `  Recommend rollback: at least ${policy.rules.rollbackRecommended.minimumAssessedAttempts} assessed` +
        ` · at least ${policy.rules.rollbackRecommended.minimumFailedAttempts} failed`,
      `  File: .lervo/search-rollout-policies/${policy.policyId}.yaml`,
      "  This policy assesses review eligibility only; it does not choose a decision or change the search engine.",
    ].join("\n") + "\n"
  );
}

const failureLabels: Record<SearchRolloutPolicyAssessment["failureReasons"][number], string> = {
  policy_not_bound: "review is not bound to a policy",
  policy_mismatch: "review is bound to a different policy",
  policy_created_after_review: "policy was created after the review",
  reviewer_not_allowed: "reviewer is not allowed",
  candidate_not_allowed: "candidate is not allowed",
  insufficient_assessed_attempts: "insufficient assessed attempts",
  too_many_failed_attempts: "too many failed attempts",
  too_few_failed_attempts: "too few failures to recommend rollback",
};

export function formatSearchRolloutPolicyAssessment(
  assessment: SearchRolloutPolicyAssessment,
): string {
  const reasons =
    assessment.failureReasons.length === 0
      ? "none"
      : assessment.failureReasons.map((reason) => failureLabels[reason]).join(", ");
  return (
    [
      `Search rollout review policy check: ${assessment.rolloutReviewId}`,
      `  Policy binding: ${
        assessment.policyBindingState === "bound"
          ? "matched"
          : assessment.policyBindingState === "legacy_unbound"
            ? "legacy unbound review"
            : "different policy"
      }`,
      `  Recorded decision: ${assessment.reviewDecisionEligibility === "eligible" ? "eligible" : "ineligible"}`,
      `  Unsatisfied reasons: ${reasons}`,
      "  This check does not choose a decision or execute approval, rollback, or search-engine changes.",
    ].join("\n") + "\n"
  );
}

export function formatSearchRolloutStatus(status: SearchRolloutStatusPage): string {
  const selection =
    status.currentSelection.selectionState === "implicit_baseline"
      ? "default lexical selection without a transition"
      : status.currentSelection.selectionState === "recorded_baseline"
        ? `recorded baseline · ${status.currentSelection.selectionTransitionId}`
        : `${status.currentSelection.engine.id}-v${status.currentSelection.engine.version}` +
          ` · ${status.currentSelection.selectionTransitionId}`;
  const lines = [
    "Search rollout review status:",
    `  Current selection: ${selection}`,
    `  Review sources ${status.reviewCount} · this page ${status.reviews.length}`,
    ...status.reviews.flatMap((item) => [
      `  ${item.review.rolloutReviewId} · ${decisionLabel(item.review.decision)}`,
      `    ${item.selectionRelation === "current_selection" ? "current selection" : "historical selection"}` +
        ` · quality input ${item.qualityInputState === "unchanged" ? "unchanged" : "changed"}`,
      `    Current attempts ${item.currentQualitySnapshot.totalAttempts} · assessed ` +
        `${item.currentQualitySnapshot.assessedAttempts} · failed ${item.currentQualitySnapshot.failedAttempts}`,
    ]),
    status.nextCursor === null ? "  No next page" : `  Next cursor: ${status.nextCursor}`,
    "  This query does not select a review as approval or change the search engine.",
  ];
  return `${lines.join("\n")}\n`;
}
