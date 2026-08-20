import type { RoleEvaluationBundle, RoleProfile } from "@lervo/schemas";

import { calculateRoleEvaluationBundleId, roleProfileHash } from "./integrity.js";
import type { RoleDefinition } from "./types.js";

export const defaultRoleWritingPolicyId = "writing_ko-kr-human";

export function defineRole(
  profile: RoleProfile,
  checks: RoleEvaluationBundle["checks"],
): RoleDefinition {
  const content: Omit<RoleEvaluationBundle, "bundleId"> = {
    schemaVersion: 1,
    roleId: profile.roleId,
    roleProfileHash: roleProfileHash(profile),
    outputSchemaRef: profile.outputContract.schemaRef,
    checks,
    publicationRequiresPassedEvaluation: true,
    highRiskDisposition: "deliberation_required",
  };
  return {
    profile: structuredClone(profile),
    evaluation: {
      ...content,
      bundleId: calculateRoleEvaluationBundleId(content),
    },
  };
}
