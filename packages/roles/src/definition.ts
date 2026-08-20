import type { RoleEvaluationBundle } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import {
  calculateRoleEvaluationBundleId,
  roleProfileHash,
} from "./integrity.js";
import type { RoleDefinition } from "./types.js";
import { RoleContractError } from "./types.js";

function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) =>
    index === 0 || values[index - 1]! < value);
}

function projectSuites(bundle: RoleEvaluationBundle): string[] {
  return bundle.checks
    .filter((check) => check.method === "project_verification")
    .map((check) => check.verificationSuiteId!)
    .sort();
}

export function assertRoleDefinition(definition: RoleDefinition): void {
  const { profile, evaluation } = definition;
  if (!validateSchema("role", profile).valid) {
    throw new RoleContractError("role_profile_invalid", "RoleProfile schema가 유효하지 않습니다.");
  }
  if (!validateSchema("roleEvaluationBundle", evaluation).valid ||
    evaluation.bundleId !== calculateRoleEvaluationBundleId(evaluation) ||
    evaluation.roleId !== profile.roleId ||
    evaluation.roleProfileHash !== roleProfileHash(profile) ||
    evaluation.outputSchemaRef !== profile.outputContract.schemaRef ||
    !sortedUnique(evaluation.checks.map((check) => check.checkId))) {
    throw new RoleContractError(
      "evaluation_bundle_invalid",
      "역할 평가 묶음의 schema, ID, RoleProfile 또는 check 순서가 유효하지 않습니다.",
    );
  }
  for (const check of evaluation.checks) {
    const project = check.method === "project_verification";
    if (project !== (check.verificationSuiteId !== null)) {
      throw new RoleContractError(
        "evaluation_bundle_invalid",
        "Project verification check만 verification suite를 가질 수 있습니다.",
      );
    }
  }
  const profileSuites = [...profile.verification.suiteIds].sort();
  if (!sortedUnique(profileSuites) ||
    JSON.stringify(profileSuites) !== JSON.stringify(projectSuites(evaluation))) {
    throw new RoleContractError(
      "evaluation_bundle_invalid",
      "RoleProfile verification suite와 평가 묶음의 project verification이 다릅니다.",
    );
  }
}
