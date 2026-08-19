import { lintDeterministicWriting } from "@lervo/core";
import type { WritingContract, WritingEvaluation } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { calculateWritingEvaluationId } from "./integrity.js";
import { runSemanticEvaluation } from "./semantic-evaluation.js";
import {
  WritingPublicationError,
  type SemanticEvaluationStatus,
  type WritingArtifactCoordinate,
  type WritingSemanticEvaluator,
} from "./types.js";

function derivedStatus(checks: WritingEvaluation["checks"]): WritingEvaluation["overallStatus"] {
  if (checks.some((check) => check.status === "not_run")) return "incomplete";
  return checks.every((check) => check.status === "passed" && check.violationCount === 0)
    ? "passed" : "failed";
}

export async function createWritingEvaluation(input: {
  content: string;
  artifact: WritingArtifactCoordinate;
  contract: WritingContract;
  surface: Parameters<WritingSemanticEvaluator["evaluate"]>[0]["surface"];
  evaluator?: WritingSemanticEvaluator;
  checkedAt: string;
}): Promise<{ evaluation: WritingEvaluation; semanticStatus: SemanticEvaluationStatus }> {
  const deterministicChecks = lintDeterministicWriting(input.content, input.contract);
  const semantic = await runSemanticEvaluation({
    content: input.content,
    artifact: input.artifact,
    contract: input.contract,
    surface: input.surface,
    ...(input.evaluator === undefined ? {} : { evaluator: input.evaluator }),
    deterministicPassed: deterministicChecks.every(
      (check) => check.status === "passed" && check.violationCount === 0,
    ),
  });
  const checks = [...deterministicChecks, ...semantic.checks];
  const content: Omit<WritingEvaluation, "evaluationId"> = {
    schemaVersion: 1,
    writingPolicyId: input.contract.writingPolicyId,
    artifactId: input.artifact.artifactId,
    contentHash: input.artifact.contentHash,
    locale: input.contract.locale,
    checkedAt: input.checkedAt,
    evaluators: [
      { kind: "deterministic", evaluatorId: "lervo.core.writing-lint.v1" },
      ...(semantic.evaluator === null ? [] : [semantic.evaluator]),
    ],
    checks,
    overallStatus: derivedStatus(checks),
  };
  const evaluation: WritingEvaluation = {
    ...content,
    evaluationId: calculateWritingEvaluationId(content),
  };
  validateWritingEvaluation(evaluation, input.contract);
  return { evaluation, semanticStatus: semantic.status };
}

export function validateWritingEvaluation(
  evaluation: WritingEvaluation,
  contract: WritingContract,
): void {
  if (!validateSchema("writingEvaluation", evaluation).valid) {
    throw new WritingPublicationError(
      "evaluation_contract_invalid",
      "Writing evaluation이 schema를 통과하지 못했습니다.",
    );
  }
  const expectedChecks = new Set([
    ...contract.verification.deterministicChecks.map((id) => `deterministic:${id}`),
    ...contract.verification.semanticChecks.filter((check) => check.required)
      .map((check) => `semantic:${check.checkId}`),
  ]);
  const actualChecks = new Set(evaluation.checks.map((check) => `${check.kind}:${check.checkId}`));
  const deterministicEvaluators = evaluation.evaluators.filter(
    (evaluator) => evaluator.kind === "deterministic",
  );
  const semanticEvaluators = evaluation.evaluators.filter(
    (evaluator) => evaluator.kind === "model" || evaluator.kind === "human",
  );
  const semanticWasRun = evaluation.checks.some(
    (check) => check.kind === "semantic" && check.status !== "not_run",
  );
  if (
    evaluation.writingPolicyId !== contract.writingPolicyId ||
    evaluation.locale !== contract.locale ||
    evaluation.checks.length !== expectedChecks.size || actualChecks.size !== expectedChecks.size ||
    [...expectedChecks].some((check) => !actualChecks.has(check)) ||
    deterministicEvaluators.length !== 1 ||
    deterministicEvaluators[0]?.evaluatorId !== "lervo.core.writing-lint.v1" ||
    semanticEvaluators.length !== (semanticWasRun ? 1 : 0) ||
    evaluation.overallStatus !== derivedStatus(evaluation.checks) ||
    evaluation.evaluationId !== calculateWritingEvaluationId(evaluation)
  ) {
    throw new WritingPublicationError(
      "evaluation_contract_invalid",
      "Writing evaluation의 schema, 필수 검사 또는 파생 상태가 계약과 다릅니다.",
    );
  }
}
