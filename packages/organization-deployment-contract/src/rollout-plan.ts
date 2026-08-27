import {
  type OrganizationDeploymentPermission,
  type OrganizationDeploymentPolicy,
  type OrganizationFleetRolloutPlan,
  type OrganizationNodeEnrollment,
  validateSchema,
} from "@lervo/schemas";

import { assertOrganizationNodeEnrollment } from "./enrollment.js";
import { OrganizationDeploymentError } from "./errors.js";
import {
  assertOrganizationAuthority,
  assertOrganizationDeploymentPolicy,
  calculateOrganizationDeploymentPolicyHash,
} from "./policy.js";
import { canonicalHash, clone, contentId, isCanonicalOrder, timestamp } from "./shared.js";

type RolloutPlanContent = Omit<OrganizationFleetRolloutPlan, "rolloutPlanId">;

function rolloutAuthorityAvailable(
  policy: OrganizationDeploymentPolicy,
  projectId: string,
): boolean {
  const principals = (permission: OrganizationDeploymentPermission): string[] =>
    policy.authorities
      .filter(
        (authority) =>
          authority.projectIds.includes(projectId) && authority.permissions.includes(permission),
      )
      .map((authority) => authority.principalId);
  const approvers = principals("rollout.approve");
  const executors = principals("rollout.execute");
  const rollbackOperators = principals("rollout.rollback");
  return (
    approvers.some((approver) => executors.some((executor) => executor !== approver)) &&
    approvers.some((approver) => rollbackOperators.some((operator) => operator !== approver))
  );
}

function sameProject(
  left: OrganizationFleetRolloutPlan["target"],
  right: OrganizationNodeEnrollment["target"],
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function canonicalWaves(plan: OrganizationFleetRolloutPlan): boolean {
  const flattened = plan.waves.flatMap((wave) => wave.enrollmentIds).sort();
  return (
    isCanonicalOrder(plan.enrollmentIds) &&
    plan.waves.every(
      (wave, index) => wave.waveNumber === index + 1 && isCanonicalOrder(wave.enrollmentIds),
    ) &&
    flattened.join("\0") === plan.enrollmentIds.join("\0") &&
    (plan.enrollmentIds.length === 1 ||
      (plan.waves.length >= 2 && plan.waves[0]!.enrollmentIds.length === 1)) &&
    plan.waves.every(
      (wave, index) =>
        index === 0 || wave.enrollmentIds.length <= plan.waves[index - 1]!.enrollmentIds.length * 2,
    )
  );
}

export function assertOrganizationFleetRolloutPlan(plan: OrganizationFleetRolloutPlan): void {
  if (!validateSchema("organizationFleetRolloutPlan", plan).valid) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_plan",
      "The organization fleet rollout plan contract is invalid.",
    );
  }
  const { rolloutPlanId: _rolloutPlanId, ...content } = plan;
  if (plan.rolloutPlanId !== contentId("orp", content) || !canonicalWaves(plan)) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_plan",
      "The rollout identity, canary, wave order, or bounded expansion is invalid.",
    );
  }
}

export function assertRolloutPlanAgainstPolicy(input: {
  policy: OrganizationDeploymentPolicy;
  plan: OrganizationFleetRolloutPlan;
}): void {
  assertOrganizationDeploymentPolicy(input.policy);
  assertOrganizationFleetRolloutPlan(input.plan);
  if (
    input.plan.organizationId !== input.policy.organizationId ||
    input.plan.policyId !== input.policy.policyId ||
    input.plan.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
    !input.policy.tenancy.projects.some(
      (project) =>
        project.projectId === input.plan.target.projectId &&
        project.projectIdentityHash === input.plan.target.projectIdentityHash,
    )
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_plan",
      "The fleet rollout plan is not bound to this organization policy.",
    );
  }
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.plan.plannedBy,
    permission: "deployment.plan",
    projectId: input.plan.target.projectId,
    at: input.plan.plannedAt,
  });
  if (!rolloutAuthorityAvailable(input.policy, input.plan.target.projectId)) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_plan",
      "The policy does not provide separate rollout approval and execution authority.",
    );
  }
}

export function calculateOrganizationFleetRolloutPlanHash(
  plan: OrganizationFleetRolloutPlan,
): string {
  assertOrganizationFleetRolloutPlan(plan);
  return canonicalHash(plan);
}

export function createOrganizationFleetRolloutPlan(input: {
  policy: OrganizationDeploymentPolicy;
  enrollments: OrganizationNodeEnrollment[];
  targetRuntimeVersion: string;
  targetArtifactHash: string;
  waves: string[][];
  plannedBy: string;
  plannedAt: string;
}): OrganizationFleetRolloutPlan {
  assertOrganizationDeploymentPolicy(input.policy);
  const enrollments = input.enrollments.map((enrollment) => {
    assertOrganizationNodeEnrollment(enrollment);
    return clone(enrollment);
  });
  const target = input.policy.tenancy.projects.find(
    (project) => project.projectId === enrollments[0]?.target.projectId,
  );
  if (
    target === undefined ||
    enrollments.length === 0 ||
    enrollments.some(
      (enrollment) =>
        enrollment.organizationId !== input.policy.organizationId ||
        enrollment.policyId !== input.policy.policyId ||
        enrollment.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
        !sameProject(target, enrollment.target) ||
        timestamp(enrollment.enrolledAt) > timestamp(input.plannedAt),
    ) ||
    new Set(enrollments.map((enrollment) => enrollment.nodeId)).size !== enrollments.length ||
    new Set(enrollments.map((enrollment) => enrollment.destinationId)).size !==
      enrollments.length ||
    !rolloutAuthorityAvailable(input.policy, target.projectId)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_plan",
      "The enrollment set, project binding, or split rollout authority is invalid.",
    );
  }
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.plannedBy,
    permission: "deployment.plan",
    projectId: target.projectId,
    at: input.plannedAt,
  });
  const enrollmentIds = enrollments.map((enrollment) => enrollment.enrollmentId).sort();
  const waves = input.waves.map((ids, index) => ({
    waveNumber: index + 1,
    enrollmentIds: [...ids].sort(),
  }));
  const content: RolloutPlanContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    policyHash: calculateOrganizationDeploymentPolicyHash(input.policy),
    target: clone(target),
    targetRuntimeVersion: input.targetRuntimeVersion,
    targetArtifactHash: input.targetArtifactHash,
    enrollmentIds,
    waves,
    healthGate: {
      minimumConsecutiveReadyObservations: 3,
      maximumUnavailableNodes: 0,
      allowOfflineReady: false,
    },
    failurePolicy: "hold_for_explicit_rollback",
    plannedBy: input.plannedBy,
    plannedAt: input.plannedAt,
    effect: { deployment: "not_executed", rollback: "not_executed", approval: "not_granted" },
  };
  const plan: OrganizationFleetRolloutPlan = {
    ...content,
    rolloutPlanId: contentId("orp", content),
  };
  assertOrganizationFleetRolloutPlan(plan);
  return clone(plan);
}
