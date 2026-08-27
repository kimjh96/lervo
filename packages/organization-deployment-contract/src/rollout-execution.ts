import {
  type OrganizationDeploymentPolicy,
  type OrganizationFleetRolloutApproval,
  type OrganizationFleetRolloutPlan,
  type OrganizationFleetWaveObservation,
  type OrganizationNodeEnrollment,
  type OrganizationNodeRolloutExecutionPlan,
  type OrganizationNodeRolloutExecutionReceipt,
  type OrganizationNodeRolloutRecoveryObservation,
  validateSchema,
} from "@lervo/schemas";

import { assertOrganizationNodeEnrollment } from "./enrollment.js";
import { OrganizationDeploymentError } from "./errors.js";
import { calculateOrganizationDeploymentPolicyHash } from "./policy.js";
import { assertOrganizationFleetRolloutExecutionAuthority } from "./rollout-approval.js";
import { calculateOrganizationFleetRolloutPlanHash } from "./rollout-plan.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

export interface OrganizationNodeLocalRolloutPlanEvidence {
  nodeId: string;
  destinationId: string;
  projectId: string;
  projectIdentityHash: string;
  targetRuntimeVersion: string;
  targetArtifactHash: string;
  localPlanId: string;
  localPlanHash: string;
}

export interface OrganizationNodeLocalRolloutApplyEvidence extends OrganizationNodeLocalRolloutPlanEvidence {
  localApplyReceiptHash: string;
  completedAt: string;
  effect: "applied";
}

export interface OrganizationNodeRolloutLocalTransactionPort {
  plan(input: {
    enrollment: OrganizationNodeEnrollment;
    targetRuntimeVersion: string;
    targetArtifactHash: string;
  }): Promise<OrganizationNodeLocalRolloutPlanEvidence>;
  apply(input: {
    executionPlan: OrganizationNodeRolloutExecutionPlan;
    enrollment: OrganizationNodeEnrollment;
  }): Promise<OrganizationNodeLocalRolloutApplyEvidence>;
  inspectEffect?(input: {
    executionPlan: OrganizationNodeRolloutExecutionPlan;
    enrollment: OrganizationNodeEnrollment;
  }): Promise<OrganizationNodeRolloutRecoveryObservation>;
}

type ExecutionPlanContent = Omit<OrganizationNodeRolloutExecutionPlan, "executionPlanId">;
type ExecutionReceiptContent = Omit<OrganizationNodeRolloutExecutionReceipt, "executionReceiptId">;

function sameTarget(
  left: OrganizationFleetRolloutPlan["target"],
  right: OrganizationNodeEnrollment["target"],
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function exactLocalPlanEvidence(
  evidence: OrganizationNodeLocalRolloutPlanEvidence,
  input: {
    enrollment: OrganizationNodeEnrollment;
    plan: OrganizationFleetRolloutPlan;
  },
): boolean {
  return (
    evidence.nodeId === input.enrollment.nodeId &&
    evidence.destinationId === input.enrollment.destinationId &&
    evidence.projectId === input.enrollment.target.projectId &&
    evidence.projectIdentityHash === input.enrollment.target.projectIdentityHash &&
    evidence.targetRuntimeVersion === input.plan.targetRuntimeVersion &&
    evidence.targetArtifactHash === input.plan.targetArtifactHash &&
    /^nfp_[a-f0-9]{24}$/u.test(evidence.localPlanId) &&
    /^sha256:[a-f0-9]{64}$/u.test(evidence.localPlanHash)
  );
}

function assertExecutionContext(input: {
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation?: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  executedBy: string;
  at: string;
}): void {
  assertOrganizationNodeEnrollment(input.enrollment);
  assertOrganizationFleetRolloutExecutionAuthority({
    policy: input.policy,
    plan: input.rolloutPlan,
    approval: input.approval,
    ...(input.observation === undefined ? {} : { observation: input.observation }),
    principalId: input.executedBy,
    at: input.at,
  });
  const wave = input.rolloutPlan.waves[input.approval.waveNumber - 1];
  if (
    input.approval.action !== "execute_wave" ||
    wave === undefined ||
    !wave.enrollmentIds.includes(input.enrollment.enrollmentId) ||
    input.enrollment.organizationId !== input.policy.organizationId ||
    input.enrollment.policyId !== input.policy.policyId ||
    input.enrollment.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
    !sameTarget(input.rolloutPlan.target, input.enrollment.target)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The Node execution target is not an exact member of the approved rollout wave.",
    );
  }
}

export function calculateOrganizationNodeRolloutExecutionPlanHash(
  plan: OrganizationNodeRolloutExecutionPlan,
): string {
  assertOrganizationNodeRolloutExecutionPlan(plan);
  return canonicalHash(plan);
}

export function assertOrganizationNodeRolloutExecutionPlan(
  plan: OrganizationNodeRolloutExecutionPlan,
): void {
  if (!validateSchema("organizationNodeRolloutExecutionPlan", plan).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The organization Node rollout execution plan contract is invalid.",
    );
  }
  const { executionPlanId: _executionPlanId, ...content } = plan;
  if (plan.executionPlanId !== contentId("oxp", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The organization Node rollout execution plan identity is invalid.",
    );
  }
}

export async function createOrganizationNodeRolloutExecutionPlan(input: {
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation?: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  executedBy: string;
  plannedAt: string;
  port: OrganizationNodeRolloutLocalTransactionPort;
}): Promise<OrganizationNodeRolloutExecutionPlan> {
  assertExecutionContext({
    ...input,
    at: input.plannedAt,
  });
  let local: OrganizationNodeLocalRolloutPlanEvidence;
  try {
    local = await input.port.plan({
      enrollment: clone(input.enrollment),
      targetRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
      targetArtifactHash: input.rolloutPlan.targetArtifactHash,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_execution_failed",
      "The exact local Node rollout plan could not be obtained.",
      { cause: error },
    );
  }
  if (!exactLocalPlanEvidence(local, { enrollment: input.enrollment, plan: input.rolloutPlan })) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The local Node plan does not match the approved rollout target.",
    );
  }
  const content: ExecutionPlanContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    rolloutPlanId: input.rolloutPlan.rolloutPlanId,
    rolloutPlanHash: calculateOrganizationFleetRolloutPlanHash(input.rolloutPlan),
    approvalId: input.approval.approvalId,
    approvalHash: canonicalHash(input.approval),
    waveNumber: input.approval.waveNumber,
    action: "execute_wave",
    target: clone(input.rolloutPlan.target),
    enrollmentId: input.enrollment.enrollmentId,
    nodeId: input.enrollment.nodeId,
    destinationId: input.enrollment.destinationId,
    targetRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
    targetArtifactHash: input.rolloutPlan.targetArtifactHash,
    localPlanId: local.localPlanId,
    localPlanHash: local.localPlanHash,
    executedBy: input.executedBy,
    plannedAt: input.plannedAt,
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const plan: OrganizationNodeRolloutExecutionPlan = {
    ...content,
    executionPlanId: contentId("oxp", content),
  };
  assertOrganizationNodeRolloutExecutionPlan(plan);
  return clone(plan);
}

function assertPlanAgainstContext(input: {
  executionPlan: OrganizationNodeRolloutExecutionPlan;
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation?: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  executedAt: string;
}): void {
  assertOrganizationNodeRolloutExecutionPlan(input.executionPlan);
  assertExecutionContext({
    ...input,
    executedBy: input.executionPlan.executedBy,
    at: input.executedAt,
  });
  if (
    input.executionPlan.organizationId !== input.policy.organizationId ||
    input.executionPlan.policyId !== input.policy.policyId ||
    input.executionPlan.rolloutPlanId !== input.rolloutPlan.rolloutPlanId ||
    input.executionPlan.rolloutPlanHash !==
      calculateOrganizationFleetRolloutPlanHash(input.rolloutPlan) ||
    input.executionPlan.approvalId !== input.approval.approvalId ||
    input.executionPlan.approvalHash !== canonicalHash(input.approval) ||
    input.executionPlan.enrollmentId !== input.enrollment.enrollmentId ||
    input.executionPlan.nodeId !== input.enrollment.nodeId ||
    input.executionPlan.destinationId !== input.enrollment.destinationId ||
    input.executionPlan.targetRuntimeVersion !== input.rolloutPlan.targetRuntimeVersion ||
    input.executionPlan.targetArtifactHash !== input.rolloutPlan.targetArtifactHash ||
    timestamp(input.executedAt) < timestamp(input.executionPlan.plannedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The execution plan no longer matches its policy, approval, enrollment, or rollout target.",
    );
  }
}

export function assertOrganizationNodeRolloutExecutionReceipt(
  receipt: OrganizationNodeRolloutExecutionReceipt,
): void {
  if (!validateSchema("organizationNodeRolloutExecutionReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_receipt",
      "The organization Node rollout execution receipt contract is invalid.",
    );
  }
  const { executionReceiptId: _executionReceiptId, ...content } = receipt;
  if (receipt.executionReceiptId !== contentId("oxr", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_receipt",
      "The organization Node rollout execution receipt identity is invalid.",
    );
  }
}

export async function applyOrganizationNodeRolloutExecution(input: {
  executionPlan: OrganizationNodeRolloutExecutionPlan;
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation?: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  executedAt: string;
  port: OrganizationNodeRolloutLocalTransactionPort;
}): Promise<OrganizationNodeRolloutExecutionReceipt> {
  assertPlanAgainstContext(input);
  let current: OrganizationNodeLocalRolloutPlanEvidence;
  try {
    current = await input.port.plan({
      enrollment: clone(input.enrollment),
      targetRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
      targetArtifactHash: input.rolloutPlan.targetArtifactHash,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_execution_failed",
      "The local Node plan could not be revalidated before apply.",
      { cause: error },
    );
  }
  if (
    !exactLocalPlanEvidence(current, {
      enrollment: input.enrollment,
      plan: input.rolloutPlan,
    }) ||
    current.localPlanId !== input.executionPlan.localPlanId ||
    current.localPlanHash !== input.executionPlan.localPlanHash
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_plan",
      "The exact local Node plan changed before apply.",
    );
  }
  let applied: OrganizationNodeLocalRolloutApplyEvidence;
  try {
    applied = await input.port.apply({
      executionPlan: clone(input.executionPlan),
      enrollment: clone(input.enrollment),
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_execution_failed",
      "The local Node rollout transaction did not produce a successful receipt.",
      { cause: error },
    );
  }
  if (
    !exactLocalPlanEvidence(applied, {
      enrollment: input.enrollment,
      plan: input.rolloutPlan,
    }) ||
    applied.localPlanId !== input.executionPlan.localPlanId ||
    applied.localPlanHash !== input.executionPlan.localPlanHash ||
    !/^sha256:[a-f0-9]{64}$/u.test(applied.localApplyReceiptHash) ||
    applied.effect !== "applied" ||
    timestamp(applied.completedAt) < timestamp(input.executedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_execution_receipt",
      "The local apply receipt does not match the exact Node execution plan.",
    );
  }
  const content: ExecutionReceiptContent = {
    schemaVersion: 1,
    executionPlanId: input.executionPlan.executionPlanId,
    executionPlanHash: calculateOrganizationNodeRolloutExecutionPlanHash(input.executionPlan),
    organizationId: input.executionPlan.organizationId,
    policyId: input.executionPlan.policyId,
    rolloutPlanId: input.executionPlan.rolloutPlanId,
    approvalId: input.executionPlan.approvalId,
    waveNumber: input.executionPlan.waveNumber,
    action: "execute_wave",
    projectId: input.executionPlan.target.projectId,
    enrollmentId: input.executionPlan.enrollmentId,
    nodeId: input.executionPlan.nodeId,
    destinationId: input.executionPlan.destinationId,
    targetRuntimeVersion: input.executionPlan.targetRuntimeVersion,
    targetArtifactHash: input.executionPlan.targetArtifactHash,
    localPlanId: input.executionPlan.localPlanId,
    localPlanHash: input.executionPlan.localPlanHash,
    localApplyReceiptHash: applied.localApplyReceiptHash,
    executedBy: input.executionPlan.executedBy,
    completedAt: applied.completedAt,
    effect: { deployment: "executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const receipt: OrganizationNodeRolloutExecutionReceipt = {
    ...content,
    executionReceiptId: contentId("oxr", content),
  };
  assertOrganizationNodeRolloutExecutionReceipt(receipt);
  return clone(receipt);
}
