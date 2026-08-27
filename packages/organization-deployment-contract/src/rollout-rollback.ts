import {
  type OrganizationDeploymentPolicy,
  type OrganizationFleetRolloutApproval,
  type OrganizationFleetRolloutPlan,
  type OrganizationFleetWaveObservation,
  type OrganizationNodeEnrollment,
  type OrganizationNodeRolloutRollbackPlan,
  type OrganizationNodeRolloutRollbackReceipt,
  type OrganizationNodeRolloutRecoveryObservation,
  validateSchema,
} from "@lervo/schemas";

import { assertOrganizationNodeEnrollment } from "./enrollment.js";
import { OrganizationDeploymentError } from "./errors.js";
import { calculateOrganizationDeploymentPolicyHash } from "./policy.js";
import { assertOrganizationFleetRolloutExecutionAuthority } from "./rollout-approval.js";
import { calculateOrganizationFleetRolloutPlanHash } from "./rollout-plan.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

export interface OrganizationNodeLocalRollbackPlanEvidence {
  nodeId: string;
  destinationId: string;
  projectId: string;
  projectIdentityHash: string;
  failedRuntimeVersion: string;
  failedArtifactHash: string;
  predecessorRuntimeVersion: string;
  predecessorArtifactHash: string;
  localPlanId: string;
  localPlanHash: string;
}

export interface OrganizationNodeLocalRollbackApplyEvidence extends OrganizationNodeLocalRollbackPlanEvidence {
  localApplyReceiptHash: string;
  completedAt: string;
  effect: "rolled_back";
}

export interface OrganizationNodeRolloutLocalRollbackPort {
  plan(input: {
    enrollment: OrganizationNodeEnrollment;
    failedRuntimeVersion: string;
    failedArtifactHash: string;
    predecessorRuntimeVersion: string;
    predecessorArtifactHash: string;
  }): Promise<OrganizationNodeLocalRollbackPlanEvidence>;
  rollback(input: {
    rollbackPlan: OrganizationNodeRolloutRollbackPlan;
    enrollment: OrganizationNodeEnrollment;
  }): Promise<OrganizationNodeLocalRollbackApplyEvidence>;
  inspectEffect?(input: {
    rollbackPlan: OrganizationNodeRolloutRollbackPlan;
    enrollment: OrganizationNodeEnrollment;
  }): Promise<OrganizationNodeRolloutRecoveryObservation>;
}

type RollbackPlanContent = Omit<OrganizationNodeRolloutRollbackPlan, "rollbackPlanId">;
type RollbackReceiptContent = Omit<OrganizationNodeRolloutRollbackReceipt, "rollbackReceiptId">;

function sameTarget(
  left: OrganizationFleetRolloutPlan["target"],
  right: OrganizationNodeEnrollment["target"],
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function assertRollbackContext(input: {
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  rolledBackBy: string;
  at: string;
}): void {
  assertOrganizationNodeEnrollment(input.enrollment);
  assertOrganizationFleetRolloutExecutionAuthority({
    policy: input.policy,
    plan: input.rolloutPlan,
    approval: input.approval,
    observation: input.observation,
    principalId: input.rolledBackBy,
    at: input.at,
  });
  const wave = input.rolloutPlan.waves[input.approval.waveNumber - 1];
  const observedNode = input.observation.nodes.find(
    (node) => node.enrollmentId === input.enrollment.enrollmentId,
  );
  if (
    input.approval.action !== "rollback_wave" ||
    wave === undefined ||
    !wave.enrollmentIds.includes(input.enrollment.enrollmentId) ||
    input.enrollment.organizationId !== input.policy.organizationId ||
    input.enrollment.policyId !== input.policy.policyId ||
    input.enrollment.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
    !sameTarget(input.rolloutPlan.target, input.enrollment.target) ||
    input.enrollment.runtimeVersion === input.rolloutPlan.targetRuntimeVersion ||
    input.enrollment.runtimeArtifactHash === input.rolloutPlan.targetArtifactHash ||
    observedNode === undefined ||
    observedNode.nodeId !== input.enrollment.nodeId ||
    observedNode.runtimeVersion !== input.rolloutPlan.targetRuntimeVersion ||
    observedNode.runtimeArtifactHash !== input.rolloutPlan.targetArtifactHash ||
    observedNode.readiness.status === "ready" ||
    observedNode.readiness.status === "pending"
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The Node rollback target is not an exact failed target with a distinct enrolled predecessor.",
    );
  }
}

function exactLocalEvidence(
  evidence: OrganizationNodeLocalRollbackPlanEvidence,
  input: {
    enrollment: OrganizationNodeEnrollment;
    rolloutPlan: OrganizationFleetRolloutPlan;
  },
): boolean {
  return (
    evidence.nodeId === input.enrollment.nodeId &&
    evidence.destinationId === input.enrollment.destinationId &&
    evidence.projectId === input.enrollment.target.projectId &&
    evidence.projectIdentityHash === input.enrollment.target.projectIdentityHash &&
    evidence.failedRuntimeVersion === input.rolloutPlan.targetRuntimeVersion &&
    evidence.failedArtifactHash === input.rolloutPlan.targetArtifactHash &&
    evidence.predecessorRuntimeVersion === input.enrollment.runtimeVersion &&
    evidence.predecessorArtifactHash === input.enrollment.runtimeArtifactHash &&
    /^nfp_[a-f0-9]{24}$/u.test(evidence.localPlanId) &&
    /^sha256:[a-f0-9]{64}$/u.test(evidence.localPlanHash)
  );
}

export function assertOrganizationNodeRolloutRollbackPlan(
  plan: OrganizationNodeRolloutRollbackPlan,
): void {
  if (!validateSchema("organizationNodeRolloutRollbackPlan", plan).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The organization Node rollout rollback plan contract is invalid.",
    );
  }
  const { rollbackPlanId: _rollbackPlanId, ...content } = plan;
  if (plan.rollbackPlanId !== contentId("orb", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The organization Node rollout rollback plan identity is invalid.",
    );
  }
}

export function calculateOrganizationNodeRolloutRollbackPlanHash(
  plan: OrganizationNodeRolloutRollbackPlan,
): string {
  assertOrganizationNodeRolloutRollbackPlan(plan);
  return canonicalHash(plan);
}

export async function createOrganizationNodeRolloutRollbackPlan(input: {
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  rolledBackBy: string;
  plannedAt: string;
  port: OrganizationNodeRolloutLocalRollbackPort;
}): Promise<OrganizationNodeRolloutRollbackPlan> {
  assertRollbackContext({ ...input, at: input.plannedAt });
  let local: OrganizationNodeLocalRollbackPlanEvidence;
  try {
    local = await input.port.plan({
      enrollment: clone(input.enrollment),
      failedRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
      failedArtifactHash: input.rolloutPlan.targetArtifactHash,
      predecessorRuntimeVersion: input.enrollment.runtimeVersion,
      predecessorArtifactHash: input.enrollment.runtimeArtifactHash,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_rollback_failed",
      "The exact local Node rollback plan could not be obtained.",
      { cause: error },
    );
  }
  if (!exactLocalEvidence(local, input)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The local Node rollback plan does not match the failed target and enrolled predecessor.",
    );
  }
  const content: RollbackPlanContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    rolloutPlanId: input.rolloutPlan.rolloutPlanId,
    rolloutPlanHash: calculateOrganizationFleetRolloutPlanHash(input.rolloutPlan),
    approvalId: input.approval.approvalId,
    approvalHash: canonicalHash(input.approval),
    evidenceObservationId: input.observation.observationId,
    evidenceObservationHash: canonicalHash(input.observation),
    waveNumber: input.approval.waveNumber,
    action: "rollback_wave",
    target: clone(input.rolloutPlan.target),
    enrollmentId: input.enrollment.enrollmentId,
    nodeId: input.enrollment.nodeId,
    destinationId: input.enrollment.destinationId,
    failedRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
    failedArtifactHash: input.rolloutPlan.targetArtifactHash,
    predecessorRuntimeVersion: input.enrollment.runtimeVersion,
    predecessorArtifactHash: input.enrollment.runtimeArtifactHash,
    localPlanId: local.localPlanId,
    localPlanHash: local.localPlanHash,
    rolledBackBy: input.rolledBackBy,
    plannedAt: input.plannedAt,
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const plan: OrganizationNodeRolloutRollbackPlan = {
    ...content,
    rollbackPlanId: contentId("orb", content),
  };
  assertOrganizationNodeRolloutRollbackPlan(plan);
  return clone(plan);
}

function assertPlanContext(input: {
  rollbackPlan: OrganizationNodeRolloutRollbackPlan;
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  rolledBackAt: string;
}): void {
  assertOrganizationNodeRolloutRollbackPlan(input.rollbackPlan);
  assertRollbackContext({
    ...input,
    rolledBackBy: input.rollbackPlan.rolledBackBy,
    at: input.rolledBackAt,
  });
  if (
    input.rollbackPlan.organizationId !== input.policy.organizationId ||
    input.rollbackPlan.policyId !== input.policy.policyId ||
    input.rollbackPlan.rolloutPlanId !== input.rolloutPlan.rolloutPlanId ||
    input.rollbackPlan.rolloutPlanHash !==
      calculateOrganizationFleetRolloutPlanHash(input.rolloutPlan) ||
    input.rollbackPlan.approvalId !== input.approval.approvalId ||
    input.rollbackPlan.approvalHash !== canonicalHash(input.approval) ||
    input.rollbackPlan.evidenceObservationId !== input.observation.observationId ||
    input.rollbackPlan.evidenceObservationHash !== canonicalHash(input.observation) ||
    input.rollbackPlan.enrollmentId !== input.enrollment.enrollmentId ||
    input.rollbackPlan.nodeId !== input.enrollment.nodeId ||
    input.rollbackPlan.destinationId !== input.enrollment.destinationId ||
    input.rollbackPlan.failedRuntimeVersion !== input.rolloutPlan.targetRuntimeVersion ||
    input.rollbackPlan.failedArtifactHash !== input.rolloutPlan.targetArtifactHash ||
    input.rollbackPlan.predecessorRuntimeVersion !== input.enrollment.runtimeVersion ||
    input.rollbackPlan.predecessorArtifactHash !== input.enrollment.runtimeArtifactHash ||
    timestamp(input.rolledBackAt) < timestamp(input.rollbackPlan.plannedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The rollback plan no longer matches its approval, failed observation, or predecessor.",
    );
  }
}

export function assertOrganizationNodeRolloutRollbackReceipt(
  receipt: OrganizationNodeRolloutRollbackReceipt,
): void {
  if (!validateSchema("organizationNodeRolloutRollbackReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_receipt",
      "The organization Node rollout rollback receipt contract is invalid.",
    );
  }
  const { rollbackReceiptId: _rollbackReceiptId, ...content } = receipt;
  if (receipt.rollbackReceiptId !== contentId("orr", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_receipt",
      "The organization Node rollout rollback receipt identity is invalid.",
    );
  }
}

export async function applyOrganizationNodeRolloutRollback(input: {
  rollbackPlan: OrganizationNodeRolloutRollbackPlan;
  policy: OrganizationDeploymentPolicy;
  rolloutPlan: OrganizationFleetRolloutPlan;
  approval: OrganizationFleetRolloutApproval;
  observation: OrganizationFleetWaveObservation;
  enrollment: OrganizationNodeEnrollment;
  rolledBackAt: string;
  port: OrganizationNodeRolloutLocalRollbackPort;
}): Promise<OrganizationNodeRolloutRollbackReceipt> {
  assertPlanContext(input);
  let current: OrganizationNodeLocalRollbackPlanEvidence;
  try {
    current = await input.port.plan({
      enrollment: clone(input.enrollment),
      failedRuntimeVersion: input.rolloutPlan.targetRuntimeVersion,
      failedArtifactHash: input.rolloutPlan.targetArtifactHash,
      predecessorRuntimeVersion: input.enrollment.runtimeVersion,
      predecessorArtifactHash: input.enrollment.runtimeArtifactHash,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_rollback_failed",
      "The local Node rollback plan could not be revalidated before apply.",
      { cause: error },
    );
  }
  if (
    !exactLocalEvidence(current, input) ||
    current.localPlanId !== input.rollbackPlan.localPlanId ||
    current.localPlanHash !== input.rollbackPlan.localPlanHash
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_plan",
      "The exact local Node rollback plan changed before apply.",
    );
  }
  let applied: OrganizationNodeLocalRollbackApplyEvidence;
  try {
    applied = await input.port.rollback({
      rollbackPlan: clone(input.rollbackPlan),
      enrollment: clone(input.enrollment),
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_rollback_failed",
      "The local Node rollback transaction did not produce a successful receipt.",
      { cause: error },
    );
  }
  if (
    !exactLocalEvidence(applied, input) ||
    applied.localPlanId !== input.rollbackPlan.localPlanId ||
    applied.localPlanHash !== input.rollbackPlan.localPlanHash ||
    !/^sha256:[a-f0-9]{64}$/u.test(applied.localApplyReceiptHash) ||
    applied.effect !== "rolled_back" ||
    timestamp(applied.completedAt) < timestamp(input.rolledBackAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_rollback_receipt",
      "The local rollback receipt does not match the exact predecessor-bound plan.",
    );
  }
  const content: RollbackReceiptContent = {
    schemaVersion: 1,
    rollbackPlanId: input.rollbackPlan.rollbackPlanId,
    rollbackPlanHash: calculateOrganizationNodeRolloutRollbackPlanHash(input.rollbackPlan),
    organizationId: input.rollbackPlan.organizationId,
    policyId: input.rollbackPlan.policyId,
    rolloutPlanId: input.rollbackPlan.rolloutPlanId,
    approvalId: input.rollbackPlan.approvalId,
    evidenceObservationId: input.rollbackPlan.evidenceObservationId,
    waveNumber: input.rollbackPlan.waveNumber,
    action: "rollback_wave",
    projectId: input.rollbackPlan.target.projectId,
    enrollmentId: input.rollbackPlan.enrollmentId,
    nodeId: input.rollbackPlan.nodeId,
    destinationId: input.rollbackPlan.destinationId,
    failedRuntimeVersion: input.rollbackPlan.failedRuntimeVersion,
    failedArtifactHash: input.rollbackPlan.failedArtifactHash,
    predecessorRuntimeVersion: input.rollbackPlan.predecessorRuntimeVersion,
    predecessorArtifactHash: input.rollbackPlan.predecessorArtifactHash,
    localPlanId: input.rollbackPlan.localPlanId,
    localPlanHash: input.rollbackPlan.localPlanHash,
    localApplyReceiptHash: applied.localApplyReceiptHash,
    rolledBackBy: input.rollbackPlan.rolledBackBy,
    completedAt: applied.completedAt,
    effect: { deployment: "not_executed", rollback: "executed" },
    secretMaterial: "excluded",
  };
  const receipt: OrganizationNodeRolloutRollbackReceipt = {
    ...content,
    rollbackReceiptId: contentId("orr", content),
  };
  assertOrganizationNodeRolloutRollbackReceipt(receipt);
  return clone(receipt);
}
