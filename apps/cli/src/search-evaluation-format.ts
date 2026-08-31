import type {
  SearchEvaluationBundle,
  SearchEvaluationCase,
  SearchEvaluationComparison,
  SearchEvaluationCoverage,
  SearchEvaluationRun,
  SearchCandidateReview,
  SearchEngineActivation,
  SearchEngineActivationPolicy,
  SearchEngineIdentity,
} from "@lervo/search";

export function formatSearchEvaluationCase(evaluationCase: SearchEvaluationCase): string {
  return (
    [
      `Search evaluation case created: ${evaluationCase.caseId}`,
      `  Expected sources ${evaluationCase.expectation.sources.length} · within rank ${evaluationCase.expectation.maximumRank}`,
      `  File: .lervo/search-evaluations/${evaluationCase.caseId}.yaml`,
      "  This file contains a user-reviewed search sentence. Check it for secrets before committing.",
    ].join("\n") + "\n"
  );
}

export function formatSearchEvaluationRun(run: SearchEvaluationRun): string {
  return (
    [
      `Search replay evaluation: ${run.runId}`,
      `  ${run.engine.id}-v${run.engine.version} · cases ${run.totalCases}`,
      `  Passed ${run.passedCases} · failed ${run.failedCases}`,
      `  Regressions ${run.regressions} · improvements ${run.improvements}`,
      "  Embedding adoption decision: not decided",
    ].join("\n") + "\n"
  );
}

export function formatSearchEvaluationBundle(bundle: SearchEvaluationBundle): string {
  return (
    [
      `Search evaluation bundle created: ${bundle.bundleId}`,
      `  Scope ${bundle.scope.roleId} / ${bundle.scope.taskType}`,
      `  Active cases ${bundle.activeCaseIds.length} · minimum sample ${bundle.minimumActiveCases}`,
      `  File: .lervo/search-evaluations/${bundle.bundleId}.bundle.yaml`,
    ].join("\n") + "\n"
  );
}

export function formatSearchEvaluationCoverage(coverage: SearchEvaluationCoverage): string {
  return (
    [
      `Search evaluation sample: ${coverage.bundleId} · ${coverage.scope.roleId} / ${coverage.scope.taskType}`,
      `  Active ${coverage.activeCases} · minimum ${coverage.minimumActiveCases} · shortfall ${coverage.shortfall}`,
      `  Sample state: ${coverage.sampleState === "sufficient" ? "sufficient" : "insufficient"}`,
      `  Candidate comparison readiness: ${coverage.comparisonReadiness === "ready" ? "ready" : "insufficient sample"}`,
      "  Embedding adoption decision: not decided",
    ].join("\n") + "\n"
  );
}

export function formatSearchEvaluationComparison(comparison: SearchEvaluationComparison): string {
  const outcomes = {
    baseline_better_observed: "baseline advantage observed",
    candidate_better_observed: "candidate advantage observed",
    mixed: "mixed advantages observed",
    no_difference_observed: "no pass/fail difference observed",
  } as const;
  return (
    [
      `Search candidate comparison: ${comparison.comparisonId}`,
      `  Bundle ${comparison.bundleId} · cases ${comparison.totalCases}`,
      `  baseline ${comparison.baseline.engine.id}-v${comparison.baseline.engine.version}`,
      `  Candidate ${comparison.candidate.engine.id}-v${comparison.candidate.engine.version}`,
      `  Candidate wins ${comparison.candidateWins} · baseline wins ${comparison.baselineWins} · ties ${comparison.ties}`,
      `  Observed outcome: ${outcomes[comparison.observedOutcome]}`,
      "  Candidate adoption decision: not decided",
      "  Embedding adoption decision: not decided",
    ].join("\n") + "\n"
  );
}

export function formatSearchCandidateReview(review: SearchCandidateReview): string {
  const decisions = {
    adopt_candidate: "adopt candidate",
    reject_candidate: "reject candidate",
    more_samples_required: "more samples required",
  } as const;
  return (
    [
      `Search candidate review: ${review.reviewId}`,
      `  Comparison ${review.comparisonId} · candidate ${review.candidateId}`,
      `  Decision: ${decisions[review.decision]}`,
      `  Candidate replay: ${review.verification.candidateReplay === "matched" ? "matched" : "mismatched"}`,
      `  Next review state: ${review.promotionReadiness}`,
      "  Actual engine activation: not applied",
      "  Embedding adoption decision: not decided",
    ].join("\n") + "\n"
  );
}

export function formatSearchEngineActivationPolicy(policy: SearchEngineActivationPolicy): string {
  return (
    [
      `Search engine activation policy: ${policy.policyId}`,
      `  Reviewers ${policy.allowedReviewerIds.length} · operators ${policy.allowedOperatorIds.length}`,
      `  Allowed candidates: ${policy.allowedCandidateIds.join(", ")}`,
      `  Minimum candidate wins ${policy.minimumCandidateWins} · allowed baseline wins 0`,
      `  File: .lervo/search-engine-policies/${policy.policyId}.yaml`,
    ].join("\n") + "\n"
  );
}

export function formatSearchEngineActivation(activation: SearchEngineActivation): string {
  const action = {
    activate_candidate: "activate candidate",
    refresh_candidate: "refresh candidate verification source",
    rollback: "roll back to previous selection",
  } as const;
  return (
    [
      `Search engine selection transition: ${activation.activationId}`,
      `  Sequence ${activation.sequence} · ${action[activation.action]}`,
      `  ${activation.previousSelection.engine.id}-v${activation.previousSelection.engine.version}` +
        ` → ${activation.selected.engine.id}-v${activation.selected.engine.version}`,
      `  Policy ${activation.policyId} · operator ${activation.operatorId}`,
      "  Selection record: stored",
      "  Embedding adoption decision: not decided",
    ].join("\n") + "\n"
  );
}

export function formatSearchEngineStatus(status: {
  selection: { mode: string; engine: SearchEngineIdentity };
  selectionTransitionId: string | null;
  transitions: number;
  resolverState: "ready" | "unavailable";
  failureCode: string | null;
  verificationReceiptId: string | null;
  productQualificationId: string | null;
}): string {
  return (
    [
      `Search engine selection source: ${status.selection.engine.id}-v${status.selection.engine.version}`,
      `  Selection transition: ${status.selectionTransitionId ?? "none"} · total ${status.transitions}`,
      `  Search resolver: ${status.resolverState === "ready" ? "verified" : `unavailable (${status.failureCode})`}`,
      `  Candidate verification receipt: ${status.verificationReceiptId ?? "none"}`,
      `  Product qualification: ${status.productQualificationId ?? "none"}`,
    ].join("\n") + "\n"
  );
}
