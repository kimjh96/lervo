export function assessPhaseAPilotOutcome(input) {
  const { contract, runSpec, exitStatus, outcome, runCompleted } = input;
  const coreEligible =
    outcome !== null &&
    runCompleted &&
    outcome.verificationStatus === "passed" &&
    outcome.managedChanges?.length === 1 &&
    outcome.managedChanges[0]?.path === runSpec.targetPath;
  if (!coreEligible) {
    return { eligible: false, reason: "managed_run_incomplete", providerInvocationCount: 1 };
  }
  if (contract.schemaVersion === 1) {
    const eligible = exitStatus === 0 && outcome.writingPublication?.status === "allowed";
    return {
      eligible,
      reason: eligible ? null : "writing_publication_blocked",
      providerInvocationCount: 2,
    };
  }
  const publication = outcome.writingPublication;
  const publicationStatusValid =
    (publication?.status === "allowed" && exitStatus === 0) ||
    (publication?.status === "blocked" && exitStatus === 1);
  if (
    !publicationStatusValid ||
    publication.semanticEvaluationStatus !== contract.eligibility.requiredSemanticEvaluationStatus
  ) {
    return {
      eligible: false,
      reason: "semantic_publication_evaluation_incomplete",
      providerInvocationCount: 2,
    };
  }
  return { eligible: true, reason: null, providerInvocationCount: 2 };
}
