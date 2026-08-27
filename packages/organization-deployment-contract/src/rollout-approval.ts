import {
  type OrganizationDeploymentPolicy,
  type OrganizationFleetRolloutApproval,
  type OrganizationFleetRolloutPlan,
  type OrganizationFleetWaveObservation,
  validateSchema,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { assertOrganizationAuthority } from "./policy.js";
import {
  assertObservationAgainstPlan,
  evaluateOrganizationFleetWave,
} from "./rollout-observation.js";
import {
  assertRolloutPlanAgainstPolicy,
  calculateOrganizationFleetRolloutPlanHash,
} from "./rollout-plan.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

type RolloutApprovalContent = Omit<OrganizationFleetRolloutApproval, "approvalId">;

export function assertOrganizationFleetRolloutApproval(
  approval: OrganizationFleetRolloutApproval,
): void {
  if (!validateSchema("organizationFleetRolloutApproval", approval).valid) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_approval",
      "The organization fleet rollout approval contract is invalid.",
    );
  }
  const { approvalId: _approvalId, ...content } = approval;
  if (
    approval.approvalId !== contentId("ofa", content) ||
    (approval.evidenceObservationId === null) !== (approval.evidenceObservationHash === null)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_approval",
      "The fleet rollout approval identity or evidence binding is invalid.",
    );
  }
}

export function createOrganizationFleetRolloutApproval(input: {
  policy: OrganizationDeploymentPolicy;
  plan: OrganizationFleetRolloutPlan;
  waveNumber: number;
  action: OrganizationFleetRolloutApproval["action"];
  observation?: OrganizationFleetWaveObservation;
  approvedBy: string;
  approvedAt: string;
}): OrganizationFleetRolloutApproval {
  assertRolloutPlanAgainstPolicy(input);
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.approvedBy,
    permission: "rollout.approve",
    projectId: input.plan.target.projectId,
    at: input.approvedAt,
  });
  const wave = input.plan.waves[input.waveNumber - 1];
  if (
    wave === undefined ||
    input.approvedBy === input.plan.plannedBy ||
    timestamp(input.approvedAt) < timestamp(input.plan.plannedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_rollout_approval",
      "The rollout approval wave, planner separation, or timestamp is invalid.",
    );
  }
  if (input.observation !== undefined) {
    assertObservationAgainstPlan({ plan: input.plan, observation: input.observation });
    if (timestamp(input.approvedAt) < timestamp(input.observation.observedAt)) {
      throw new OrganizationDeploymentError(
        "invalid_fleet_rollout_approval",
        "The rollout approval predates its bound observation.",
      );
    }
  }
  const gate =
    input.observation === undefined
      ? null
      : evaluateOrganizationFleetWave({ plan: input.plan, observation: input.observation });
  const executionEligible =
    input.action === "execute_wave" &&
    ((input.waveNumber === 1 && input.observation === undefined) ||
      (input.waveNumber > 1 &&
        input.observation?.waveNumber === input.waveNumber - 1 &&
        gate?.state === "ready_to_advance"));
  const rollbackEligible =
    input.action === "rollback_wave" &&
    input.observation?.waveNumber === input.waveNumber &&
    gate?.state === "rollback_required";
  if (!executionEligible && !rollbackEligible) {
    throw new OrganizationDeploymentError(
      "fleet_wave_gate_not_satisfied",
      "The exact prior-wave health or current-wave failure evidence does not authorize this action.",
    );
  }
  const content: RolloutApprovalContent = {
    schemaVersion: 1,
    organizationId: input.plan.organizationId,
    policyId: input.plan.policyId,
    rolloutPlanId: input.plan.rolloutPlanId,
    rolloutPlanHash: calculateOrganizationFleetRolloutPlanHash(input.plan),
    waveNumber: input.waveNumber,
    action: input.action,
    evidenceObservationId: input.observation?.observationId ?? null,
    evidenceObservationHash:
      input.observation === undefined ? null : canonicalHash(input.observation),
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    effect: { deployment: "not_executed", rollback: "not_executed", approval: "granted" },
  };
  const approval: OrganizationFleetRolloutApproval = {
    ...content,
    approvalId: contentId("ofa", content),
  };
  assertOrganizationFleetRolloutApproval(approval);
  return clone(approval);
}

export function assertOrganizationFleetRolloutExecutionAuthority(input: {
  policy: OrganizationDeploymentPolicy;
  plan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation?: OrganizationFleetWaveObservation;
  principalId: string;
  at: string;
}): void {
  assertRolloutPlanAgainstPolicy(input);
  assertOrganizationFleetRolloutApproval(input.approval);
  if (
    input.approval.organizationId !== input.plan.organizationId ||
    input.approval.policyId !== input.plan.policyId ||
    input.approval.rolloutPlanId !== input.plan.rolloutPlanId ||
    input.approval.rolloutPlanHash !== calculateOrganizationFleetRolloutPlanHash(input.plan) ||
    input.approval.waveNumber > input.plan.waves.length ||
    input.principalId === input.approval.approvedBy ||
    timestamp(input.at) < timestamp(input.approval.approvedAt)
  ) {
    throw new OrganizationDeploymentError(
      "organization_authority_denied",
      "The rollout execution principal or exact approval binding is invalid.",
    );
  }
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.approval.approvedBy,
    permission: "rollout.approve",
    projectId: input.plan.target.projectId,
    at: input.approval.approvedAt,
  });
  if (input.approval.approvedBy === input.plan.plannedBy) {
    throw new OrganizationDeploymentError(
      "organization_authority_denied",
      "The rollout planner cannot approve the same plan.",
    );
  }
  if (input.observation !== undefined) {
    assertObservationAgainstPlan({ plan: input.plan, observation: input.observation });
  }
  const evidenceMatches =
    input.observation !== undefined &&
    input.approval.evidenceObservationId === input.observation.observationId &&
    input.approval.evidenceObservationHash === canonicalHash(input.observation);
  const gate =
    input.observation === undefined
      ? null
      : evaluateOrganizationFleetWave({ plan: input.plan, observation: input.observation });
  const approvalEligible =
    (input.approval.action === "execute_wave" &&
      ((input.approval.waveNumber === 1 &&
        input.approval.evidenceObservationId === null &&
        input.approval.evidenceObservationHash === null &&
        input.observation === undefined) ||
        (input.approval.waveNumber > 1 &&
          evidenceMatches &&
          input.observation?.waveNumber === input.approval.waveNumber - 1 &&
          gate?.state === "ready_to_advance"))) ||
    (input.approval.action === "rollback_wave" &&
      evidenceMatches &&
      input.observation?.waveNumber === input.approval.waveNumber &&
      gate?.state === "rollback_required");
  if (!approvalEligible) {
    throw new OrganizationDeploymentError(
      "fleet_wave_gate_not_satisfied",
      "The execution approval is not bound to the required exact wave evidence.",
    );
  }
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.principalId,
    permission: input.approval.action === "execute_wave" ? "rollout.execute" : "rollout.rollback",
    projectId: input.plan.target.projectId,
    at: input.at,
  });
}
