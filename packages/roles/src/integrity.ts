import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type {
  HighRiskRoleWorkflow,
  RoleEvaluationBundle,
  RoleEvaluationResult,
  RoleProfile,
} from "@lervo/schemas";

export function roleSha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function roleProfileHash(profile: RoleProfile): string {
  return roleSha256(canonicalJson(profile));
}

export function roleEvaluationBundleHash(bundle: RoleEvaluationBundle): string {
  return roleSha256(canonicalJson(bundle));
}

export function calculateRoleEvaluationBundleId(
  value: Omit<RoleEvaluationBundle, "bundleId"> | RoleEvaluationBundle,
): string {
  const { bundleId: _bundleId, ...content } = value as RoleEvaluationBundle;
  return `reb_${roleSha256(canonicalJson(content)).slice(7, 23)}`;
}

export function calculateRoleEvaluationResultId(
  value: Omit<RoleEvaluationResult, "resultId"> | RoleEvaluationResult,
): string {
  const { resultId: _resultId, ...content } = value as RoleEvaluationResult;
  return `rer_${roleSha256(canonicalJson(content)).slice(7, 23)}`;
}

export function calculateHighRiskRoleWorkflowId(
  value: Omit<HighRiskRoleWorkflow, "workflowId"> | HighRiskRoleWorkflow,
): string {
  const { workflowId: _workflowId, ...content } = value as HighRiskRoleWorkflow;
  return `hrw_${roleSha256(canonicalJson(content)).slice(7, 23)}`;
}
