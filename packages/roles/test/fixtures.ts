import type { RoleEvaluationCheckResult } from "@lervo/schemas";

import { getBuiltInRoleDefinition } from "../src/index.js";

export const artifactId = "art_role_evaluation_01";
export const contentHash = `sha256:${"a".repeat(64)}`;
export const mediaType = "text/markdown; charset=utf-8" as const;

const evidence = [{
  artifactId: "art_role_evidence_01",
  contentHash: `sha256:${"b".repeat(64)}`,
}];

export function observations(
  roleId: "researcher" | "marketer" | "designer",
  status: RoleEvaluationCheckResult["status"] = "passed",
) {
  return getBuiltInRoleDefinition(roleId).evaluation.checks.map((check) => ({
    checkId: check.checkId,
    status,
    evaluatorId: check.method === "separate_semantic"
      ? "independent.fixture-reviewer.v1"
      : "lervo.fixture.deterministic.v1",
    evaluatorRunId: check.method === "separate_semantic" ? "run_evaluator_0001" : null,
    evaluatorRoleId: check.method === "separate_semantic" ? "reviewer" : null,
    evidence: status === "not_run" ? [] : evidence,
  }));
}
