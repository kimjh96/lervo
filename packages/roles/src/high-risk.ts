import {
  type DeliberationPolicy,
  type HighRiskRoleWorkflow,
  validateSchema,
} from "@lervo/schemas";
import { validateDeliberationPolicy } from "@lervo/deliberation";

import { assertRoleDefinition } from "./definition.js";
import {
  calculateHighRiskRoleWorkflowId,
  roleEvaluationBundleHash,
  roleProfileHash,
} from "./integrity.js";
import type { RoleDefinition, RoleProviderSelection } from "./types.js";
import { RoleContractError } from "./types.js";

interface HighRiskRoleParticipant {
  definition: RoleDefinition;
  providerSelection: RoleProviderSelection;
}

function requiredSuites(definitions: readonly RoleDefinition[]): string[] {
  return [...new Set(definitions.flatMap((definition) =>
    definition.profile.verification.suiteIds))].sort();
}

export function createHighRiskRoleWorkflow(input: {
  projectId: string;
  primary: HighRiskRoleParticipant;
  reviewer: HighRiskRoleParticipant;
  verifier: HighRiskRoleParticipant;
  publication: DeliberationPolicy["publication"];
  maxRounds?: number;
}): HighRiskRoleWorkflow {
  const roles = [input.primary, input.reviewer, input.verifier];
  for (const role of roles) assertRoleDefinition(role.definition);
  const primaryRoleId = input.primary.definition.profile.roleId;
  const responsibilities = [
    ["proposer", "decision_owner"],
    ["reviewer"],
    ["verifier"],
  ] as const;
  const deliberationPolicy: DeliberationPolicy = {
    schemaVersion: 1,
    policyId: `deliberation_high-risk-${primaryRoleId}`,
    projectId: input.projectId,
    participants: roles.map((role, index) => ({
      roleId: role.definition.profile.roleId,
      responsibilities: [...responsibilities[index]!],
      providerSelection: structuredClone(role.providerSelection),
    })),
    decisionOwnerRoleId: primaryRoleId,
    maxRounds: input.maxRounds ?? 3,
    requiredVerificationSuiteIds: requiredSuites(roles.map((role) => role.definition)),
    convergence: {
      requireIndependentReviewer: true,
      requireIndependentSessions: true,
      requireDecisionOwnerDecision: true,
      requirePassedVerifications: true,
      requireZeroUnresolvedBlockingObjections: true,
      unresolvedBlockingDisposition: "no_consensus",
    },
    publication: structuredClone(input.publication),
  };
  const content: Omit<HighRiskRoleWorkflow, "workflowId"> = {
    schemaVersion: 1,
    projectId: input.projectId,
    risk: "high",
    primaryRoleId,
    roleBindings: roles.map((role, index) => ({
      roleId: role.definition.profile.roleId,
      roleProfileHash: roleProfileHash(role.definition.profile),
      evaluationBundleId: role.definition.evaluation.bundleId,
      evaluationBundleHash: roleEvaluationBundleHash(role.definition.evaluation),
      responsibilities: [...responsibilities[index]!],
    })),
    deliberationPolicy,
  };
  const workflow = {
    ...content,
    workflowId: calculateHighRiskRoleWorkflowId(content),
  };
  assertHighRiskRoleWorkflow({
    workflow,
    definitions: roles.map((role) => role.definition),
  });
  return structuredClone(workflow);
}

export function assertHighRiskRoleWorkflow(input: {
  workflow: HighRiskRoleWorkflow;
  definitions: readonly RoleDefinition[];
}): void {
  const { workflow } = input;
  for (const definition of input.definitions) assertRoleDefinition(definition);
  const definitions = new Map(input.definitions.map((definition) =>
    [definition.profile.roleId, definition]));
  if (!validateSchema("highRiskRoleWorkflow", workflow).valid ||
    workflow.workflowId !== calculateHighRiskRoleWorkflowId(workflow) ||
    workflow.projectId !== workflow.deliberationPolicy.projectId ||
    workflow.primaryRoleId !== workflow.deliberationPolicy.decisionOwnerRoleId ||
    workflow.deliberationPolicy.maxRounds > 5 ||
    definitions.size !== input.definitions.length ||
    definitions.size !== workflow.roleBindings.length) {
    throw new RoleContractError(
      "high_risk_workflow_invalid",
      "고위험 역할 workflow의 schema, ID, project, 결정 책임자 또는 회차가 유효하지 않습니다.",
    );
  }
  try {
    validateDeliberationPolicy(workflow.deliberationPolicy);
  } catch (error) {
    throw new RoleContractError(
      "high_risk_workflow_invalid",
      "고위험 역할 workflow의 숙의 정책이 유효하지 않습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  const roleIds = workflow.roleBindings.map((binding) => binding.roleId);
  const primary = workflow.roleBindings.find((binding) => binding.roleId === workflow.primaryRoleId);
  const reviewers = workflow.roleBindings.filter((binding) =>
    binding.responsibilities.includes("reviewer"));
  const verifiers = workflow.roleBindings.filter((binding) =>
    binding.responsibilities.includes("verifier"));
  if (new Set(roleIds).size !== roleIds.length || primary === undefined ||
    !primary.responsibilities.includes("proposer") ||
    !primary.responsibilities.includes("decision_owner") ||
    reviewers.length !== 1 || verifiers.length !== 1 ||
    reviewers[0]!.roleId === workflow.primaryRoleId ||
    verifiers[0]!.roleId === workflow.primaryRoleId ||
    reviewers[0]!.roleId === verifiers[0]!.roleId) {
    throw new RoleContractError(
      "high_risk_workflow_invalid",
      "고위험 workflow는 서로 다른 제안·결정, 독립 검토, 검증 역할을 가져야 합니다.",
    );
  }
  for (const binding of workflow.roleBindings) {
    const definition = definitions.get(binding.roleId);
    const participant = workflow.deliberationPolicy.participants.find((item) =>
      item.roleId === binding.roleId);
    if (definition === undefined || participant === undefined ||
      binding.roleProfileHash !== roleProfileHash(definition.profile) ||
      binding.evaluationBundleId !== definition.evaluation.bundleId ||
      binding.evaluationBundleHash !== roleEvaluationBundleHash(definition.evaluation) ||
      JSON.stringify(binding.responsibilities) !== JSON.stringify(participant.responsibilities)) {
      throw new RoleContractError(
        "high_risk_workflow_invalid",
        "고위험 workflow의 RoleProfile, 평가 묶음 또는 숙의 참여자 결속이 다릅니다.",
      );
    }
  }
  if (JSON.stringify(workflow.deliberationPolicy.requiredVerificationSuiteIds) !==
    JSON.stringify(requiredSuites(input.definitions))) {
    throw new RoleContractError(
      "high_risk_workflow_invalid",
      "고위험 workflow가 역할별 project verification 전체를 요구하지 않습니다.",
    );
  }
}
