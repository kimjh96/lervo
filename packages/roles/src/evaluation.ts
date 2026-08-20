import type { RoleEvaluationResult } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { assertRoleDefinition } from "./definition.js";
import {
  calculateRoleEvaluationResultId,
  roleEvaluationBundleHash,
  roleProfileHash,
} from "./integrity.js";
import type { RoleDefinition, RoleEvaluationObservation } from "./types.js";
import { RoleContractError } from "./types.js";

export function createRoleEvaluationResult(input: {
  definition: RoleDefinition;
  artifactId: string;
  contentHash: string;
  byteCount: number;
  mediaType: RoleEvaluationResult["mediaType"];
  producerRunId: string;
  evaluatedAt: string;
  observations: readonly RoleEvaluationObservation[];
}): RoleEvaluationResult {
  assertRoleDefinition(input.definition);
  const result = buildRoleEvaluationResult(input);
  if (!validateSchema("roleEvaluationResult", result).valid) {
    throw new RoleContractError("evaluation_result_invalid", "역할 평가 결과 schema가 유효하지 않습니다.");
  }
  return structuredClone(result);
}

export function assertRoleEvaluationResult(input: {
  definition: RoleDefinition;
  result: RoleEvaluationResult;
}): void {
  assertRoleDefinition(input.definition);
  const { result, definition } = input;
  const recreated = buildRoleEvaluationResult({
    definition,
    artifactId: result.artifactId,
    contentHash: result.contentHash,
    byteCount: result.byteCount,
    mediaType: result.mediaType,
    producerRunId: result.producerRunId,
    evaluatedAt: result.evaluatedAt,
    observations: result.checks.map(({ method: _method, ...check }) => check),
  });
  if (!validateSchema("roleEvaluationResult", result).valid ||
    JSON.stringify(result) !== JSON.stringify(recreated)) {
    throw new RoleContractError(
      "evaluation_result_invalid",
      "역할 평가 결과의 schema, ID, bundle 또는 상태가 원본과 다릅니다.",
    );
  }
}

function buildRoleEvaluationResult(input: {
  definition: RoleDefinition;
  artifactId: string;
  contentHash: string;
  byteCount: number;
  mediaType: RoleEvaluationResult["mediaType"];
  producerRunId: string;
  evaluatedAt: string;
  observations: readonly RoleEvaluationObservation[];
}): RoleEvaluationResult {
  const byCheck = new Map(input.observations.map((observation) => [observation.checkId, observation]));
  if (byCheck.size !== input.observations.length ||
    input.observations.length !== input.definition.evaluation.checks.length) {
    throw new RoleContractError("evaluation_result_invalid", "역할 평가 check 집합이 다릅니다.");
  }
  const checks = input.definition.evaluation.checks.map((check) => {
    const observation = byCheck.get(check.checkId);
    if (observation === undefined ||
      (observation.status === "not_run") !== (observation.evidence.length === 0)) {
      throw new RoleContractError("evaluation_result_invalid", "역할 평가 evidence가 유효하지 않습니다.");
    }
    const evidence = [...observation.evidence].sort((left, right) =>
      `${left.artifactId}\0${left.contentHash}`.localeCompare(`${right.artifactId}\0${right.contentHash}`));
    if (new Set(evidence.map((item) => `${item.artifactId}\0${item.contentHash}`)).size !==
      evidence.length) {
      throw new RoleContractError("evaluation_result_invalid", "역할 평가 evidence가 중복되었습니다.");
    }
    const semantic = check.method === "separate_semantic";
    if (semantic !== (observation.evaluatorRunId !== null) ||
      semantic !== (observation.evaluatorRoleId !== null) ||
      (semantic && observation.evaluatorRunId === input.producerRunId)) {
      throw new RoleContractError(
        "evaluation_result_invalid",
        "별도 의미 평가는 생산 run과 다른 evaluator run·role에 결속되어야 합니다.",
      );
    }
    return { ...structuredClone(observation), evidence, method: check.method };
  });
  const overallStatus = checks.some((check) => check.status === "failed")
    ? "failed" as const
    : checks.some((check) => check.status === "not_run")
      ? "incomplete" as const
      : "passed" as const;
  const content: Omit<RoleEvaluationResult, "resultId"> = {
    schemaVersion: 1,
    bundleId: input.definition.evaluation.bundleId,
    bundleHash: roleEvaluationBundleHash(input.definition.evaluation),
    roleId: input.definition.profile.roleId,
    roleProfileHash: roleProfileHash(input.definition.profile),
    producerRunId: input.producerRunId,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    byteCount: input.byteCount,
    mediaType: input.mediaType,
    evaluatedAt: input.evaluatedAt,
    checks,
    overallStatus,
  };
  return { ...content, resultId: calculateRoleEvaluationResultId(content) };
}
