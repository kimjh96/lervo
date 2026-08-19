import type { WritingContract, WritingEvaluation } from "@lervo/schemas";

export type WritingGateDecision =
  | { allowed: true; missingChecks: []; failedChecks: [] }
  | {
      allowed: false;
      failure: "writing_verification_failed";
      missingChecks: string[];
      failedChecks: string[];
      coordinateMismatch: boolean;
    };

export function evaluateWritingGate(input: {
  contract: WritingContract;
  evaluation: WritingEvaluation;
  artifactId: string;
  contentHash: string;
}): WritingGateDecision {
  const coordinateMismatch =
    input.evaluation.writingPolicyId !== input.contract.writingPolicyId ||
    input.evaluation.locale !== input.contract.locale ||
    input.evaluation.artifactId !== input.artifactId ||
    input.evaluation.contentHash !== input.contentHash;
  const requiredChecks = [
    ...input.contract.verification.deterministicChecks.map((checkId) => ({
      checkId,
      kind: "deterministic" as const,
    })),
    ...input.contract.verification.semanticChecks
      .filter((check) => check.required)
      .map((check) => ({ checkId: check.checkId, kind: "semantic" as const })),
  ];
  const missingChecks: string[] = [];
  const failedChecks: string[] = [];

  for (const required of requiredChecks) {
    const matches = input.evaluation.checks.filter(
      (check) => check.checkId === required.checkId && check.kind === required.kind,
    );
    if (matches.length !== 1) {
      missingChecks.push(required.checkId);
      continue;
    }
    const result = matches[0];
    if (result?.status === "not_run") {
      missingChecks.push(required.checkId);
    } else if (!result || result.status !== "passed" || result.violationCount !== 0) {
      failedChecks.push(required.checkId);
    }
  }

  const hasSeparateSemanticEvaluator = input.evaluation.evaluators.some(
    (evaluator) =>
      (evaluator.kind === "model" || evaluator.kind === "human") &&
      evaluator.phase === "separate_pass",
  );
  if (!hasSeparateSemanticEvaluator) missingChecks.push("semantic_evaluator");

  if (
    coordinateMismatch || missingChecks.length > 0 || failedChecks.length > 0 ||
    input.evaluation.overallStatus !== "passed"
  ) {
    return {
      allowed: false,
      failure: "writing_verification_failed",
      missingChecks,
      failedChecks,
      coordinateMismatch,
    };
  }
  return { allowed: true, missingChecks: [], failedChecks: [] };
}
