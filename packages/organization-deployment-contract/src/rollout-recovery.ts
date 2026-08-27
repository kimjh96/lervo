import type {
  OrganizationNodeRolloutDelivery,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationNodeRolloutRecoveryReceipt,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

type RecoveryReceiptContent = Omit<OrganizationNodeRolloutRecoveryReceipt, "recoveryReceiptId">;

export function assertOrganizationNodeRolloutRecoveryObservation(
  observation: OrganizationNodeRolloutRecoveryObservation,
): void {
  if (!validateSchema("organizationNodeRolloutRecoveryObservation", observation).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_recovery_receipt",
      "The organization Node rollout recovery observation is invalid.",
    );
  }
}

export function classifyOrganizationNodeRolloutRecovery(input: {
  baseline: OrganizationNodeRolloutRecoveryObservation;
  current: OrganizationNodeRolloutRecoveryObservation;
}): "applied" | "not_applied" | "unknown" {
  assertOrganizationNodeRolloutRecoveryObservation(input.baseline);
  assertOrganizationNodeRolloutRecoveryObservation(input.current);
  const baselineWasDesired = input.baseline.serviceTarget === "desired";
  const samePlan =
    input.baseline.localPlanId === input.current.localPlanId &&
    input.baseline.localPlanHash === input.current.localPlanHash;
  if (samePlan) return baselineWasDesired ? "unknown" : "not_applied";
  if (
    input.current.registry === "unchanged" &&
    input.current.serviceTarget === "desired" &&
    input.current.legacyTarget === "absent"
  ) {
    return "applied";
  }
  return "unknown";
}

export function assertOrganizationNodeRolloutRecoveryReceipt(
  receipt: OrganizationNodeRolloutRecoveryReceipt,
): void {
  if (!validateSchema("organizationNodeRolloutRecoveryReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_recovery_receipt",
      "The organization Node rollout recovery receipt is invalid.",
    );
  }
  const { recoveryReceiptId: _recoveryReceiptId, ...content } = receipt;
  if (receipt.recoveryReceiptId !== contentId("ory", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_recovery_receipt",
      "The organization Node rollout recovery receipt identity is invalid.",
    );
  }
}

export function createOrganizationNodeRolloutRecoveryReceipt(input: {
  delivery: OrganizationNodeRolloutDelivery;
  deliveryHash: string;
  baseline: OrganizationNodeRolloutRecoveryObservation;
  current: OrganizationNodeRolloutRecoveryObservation;
  inspectedAt: string;
}): OrganizationNodeRolloutRecoveryReceipt {
  assertOrganizationNodeRolloutRecoveryObservation(input.baseline);
  assertOrganizationNodeRolloutRecoveryObservation(input.current);
  timestamp(input.inspectedAt);
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.deliveryHash)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_recovery_receipt",
      "The organization Node rollout recovery delivery hash is invalid.",
    );
  }
  const content: RecoveryReceiptContent = {
    schemaVersion: 1,
    deliveryId: input.delivery.deliveryId,
    deliveryHash: input.deliveryHash,
    idempotencyKey: input.delivery.idempotencyKey,
    executionPlanId: input.delivery.executionPlan.executionPlanId,
    target: clone(input.delivery.target),
    nodeId: input.delivery.nodeId,
    destinationId: input.delivery.destinationId,
    inspectedAt: input.inspectedAt,
    classification: classifyOrganizationNodeRolloutRecovery(input),
    baseline: clone(input.baseline),
    current: clone(input.current),
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const receipt: OrganizationNodeRolloutRecoveryReceipt = {
    ...content,
    recoveryReceiptId: contentId("ory", content),
  };
  assertOrganizationNodeRolloutRecoveryReceipt(receipt);
  return clone(receipt);
}

export function calculateOrganizationNodeRolloutRecoveryObservationHash(
  observation: OrganizationNodeRolloutRecoveryObservation,
): string {
  assertOrganizationNodeRolloutRecoveryObservation(observation);
  return canonicalHash(observation);
}
