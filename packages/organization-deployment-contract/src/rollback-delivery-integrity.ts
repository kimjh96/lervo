import { canonicalJson } from "@lervo/event-contract";
import type {
  OrganizationNodeRollbackDelivery,
  OrganizationNodeRollbackDeliveryReceipt,
  OrganizationNodeRollbackRecoveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  SignedOrganizationNodeRollbackDelivery,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { organizationNodeRolloutSignatureBytes } from "./rollout-delivery-integrity.js";
import { classifyOrganizationNodeRolloutRecovery } from "./rollout-recovery.js";
import { calculateOrganizationNodeRolloutRollbackPlanHash } from "./rollout-rollback.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

type DeliveryContent = Omit<OrganizationNodeRollbackDelivery, "deliveryId">;
type DeliveryReceiptContent = Omit<OrganizationNodeRollbackDeliveryReceipt, "deliveryReceiptId">;
type RecoveryReceiptContent = Omit<OrganizationNodeRollbackRecoveryReceipt, "recoveryReceiptId">;

export function createOrganizationNodeRollbackDelivery(
  input: Omit<DeliveryContent, "schemaVersion" | "effect" | "secretMaterial">,
): OrganizationNodeRollbackDelivery {
  const content: DeliveryContent = {
    schemaVersion: 1,
    ...clone(input),
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const delivery = { ...content, deliveryId: contentId("obd", content) };
  assertOrganizationNodeRollbackDelivery(delivery);
  return clone(delivery);
}

export function assertOrganizationNodeRollbackDelivery(
  delivery: OrganizationNodeRollbackDelivery,
): void {
  if (!validateSchema("organizationNodeRollbackDelivery", delivery).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The organization Node rollback delivery contract is invalid.",
    );
  }
  const { deliveryId: _deliveryId, ...content } = delivery;
  if (
    delivery.deliveryId !== contentId("obd", content) ||
    timestamp(delivery.expiresAt) <= timestamp(delivery.issuedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The organization Node rollback delivery identity or interval is invalid.",
    );
  }
}

export function calculateOrganizationNodeRollbackDeliveryHash(
  delivery: OrganizationNodeRollbackDelivery,
): string {
  assertOrganizationNodeRollbackDelivery(delivery);
  return canonicalHash(delivery);
}

export function organizationNodeRollbackDeliverySigningBytes(input: {
  delivery: OrganizationNodeRollbackDelivery;
  keyId: string;
}): Uint8Array {
  assertOrganizationNodeRollbackDelivery(input.delivery);
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(input.keyId)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_signature",
      "The organization rollback delivery signature key ID is invalid.",
    );
  }
  return Buffer.from(
    canonicalJson({
      domain: "lervo.organization-node-rollback.delivery.v1",
      algorithm: "ed25519",
      keyId: input.keyId,
      delivery: clone(input.delivery),
    }),
    "utf8",
  );
}

export function createSignedOrganizationNodeRollbackDelivery(input: {
  delivery: OrganizationNodeRollbackDelivery;
  keyId: string;
  signature: Uint8Array;
}): SignedOrganizationNodeRollbackDelivery {
  if (input.signature.byteLength !== 64) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_signature",
      "An organization rollback delivery Ed25519 signature must be 64 bytes.",
    );
  }
  const envelope: SignedOrganizationNodeRollbackDelivery = {
    schemaVersion: 1,
    delivery: clone(input.delivery),
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: Buffer.from(input.signature).toString("base64url"),
    },
  };
  assertSignedOrganizationNodeRollbackDelivery(envelope);
  return clone(envelope);
}

export function assertSignedOrganizationNodeRollbackDelivery(
  envelope: SignedOrganizationNodeRollbackDelivery,
): void {
  if (!validateSchema("signedOrganizationNodeRollbackDelivery", envelope).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_signature",
      "The signed organization Node rollback delivery contract is invalid.",
    );
  }
  assertOrganizationNodeRollbackDelivery(envelope.delivery);
  organizationNodeRolloutSignatureBytes(envelope.signature.value);
}

export function assertOrganizationNodeRollbackDeliveryReceipt(
  receipt: OrganizationNodeRollbackDeliveryReceipt,
): void {
  if (!validateSchema("organizationNodeRollbackDeliveryReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_receipt",
      "The organization Node rollback delivery receipt is invalid.",
    );
  }
  const { deliveryReceiptId: _deliveryReceiptId, ...content } = receipt;
  if (receipt.deliveryReceiptId !== contentId("obr", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_receipt",
      "The organization Node rollback delivery receipt identity is invalid.",
    );
  }
}

export function createOrganizationNodeRollbackDeliveryReceipt(input: {
  delivery: OrganizationNodeRollbackDelivery;
  rollbackReceipt: OrganizationNodeRollbackDeliveryReceipt["rollbackReceipt"];
}): OrganizationNodeRollbackDeliveryReceipt {
  if (
    input.rollbackReceipt.rollbackPlanId !== input.delivery.rollbackPlan.rollbackPlanId ||
    input.rollbackReceipt.rollbackPlanHash !==
      calculateOrganizationNodeRolloutRollbackPlanHash(input.delivery.rollbackPlan)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery_receipt",
      "The rollback receipt does not match the signed delivery.",
    );
  }
  const content: DeliveryReceiptContent = {
    schemaVersion: 1,
    deliveryId: input.delivery.deliveryId,
    deliveryHash: calculateOrganizationNodeRollbackDeliveryHash(input.delivery),
    idempotencyKey: input.delivery.idempotencyKey,
    rollbackReceipt: clone(input.rollbackReceipt),
    completedAt: input.rollbackReceipt.completedAt,
    effect: { deployment: "not_executed", rollback: "executed" },
    secretMaterial: "excluded",
  };
  const receipt = { ...content, deliveryReceiptId: contentId("obr", content) };
  assertOrganizationNodeRollbackDeliveryReceipt(receipt);
  return clone(receipt);
}

export function assertOrganizationNodeRollbackRecoveryReceipt(
  receipt: OrganizationNodeRollbackRecoveryReceipt,
): void {
  if (!validateSchema("organizationNodeRollbackRecoveryReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_recovery_receipt",
      "The organization Node rollback recovery receipt is invalid.",
    );
  }
  const { recoveryReceiptId: _recoveryReceiptId, ...content } = receipt;
  if (receipt.recoveryReceiptId !== contentId("obq", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_recovery_receipt",
      "The organization Node rollback recovery receipt identity is invalid.",
    );
  }
}

export function createOrganizationNodeRollbackRecoveryReceipt(input: {
  delivery: OrganizationNodeRollbackDelivery;
  deliveryHash: string;
  baseline: OrganizationNodeRolloutRecoveryObservation;
  current: OrganizationNodeRolloutRecoveryObservation;
  inspectedAt: string;
}): OrganizationNodeRollbackRecoveryReceipt {
  const forwardClassification = classifyOrganizationNodeRolloutRecovery(input);
  const content: RecoveryReceiptContent = {
    schemaVersion: 1,
    deliveryId: input.delivery.deliveryId,
    deliveryHash: input.deliveryHash,
    idempotencyKey: input.delivery.idempotencyKey,
    rollbackPlanId: input.delivery.rollbackPlan.rollbackPlanId,
    target: clone(input.delivery.target),
    nodeId: input.delivery.nodeId,
    destinationId: input.delivery.destinationId,
    inspectedAt: input.inspectedAt,
    classification:
      forwardClassification === "applied"
        ? "rolled_back"
        : forwardClassification === "not_applied"
          ? "not_rolled_back"
          : "unknown",
    baseline: clone(input.baseline),
    current: clone(input.current),
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const receipt = { ...content, recoveryReceiptId: contentId("obq", content) };
  assertOrganizationNodeRollbackRecoveryReceipt(receipt);
  return clone(receipt);
}

export function assertMatchingOrganizationNodeRollbackDeliveryReceipt(input: {
  receipt: OrganizationNodeRollbackDeliveryReceipt;
  delivery: OrganizationNodeRollbackDelivery;
  deliveryHash: string;
}): void {
  assertOrganizationNodeRollbackDeliveryReceipt(input.receipt);
  if (
    input.receipt.deliveryId !== input.delivery.deliveryId ||
    input.receipt.deliveryHash !== input.deliveryHash ||
    input.receipt.idempotencyKey !== input.delivery.idempotencyKey
  ) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_persistence_failed",
      "The stored rollback delivery receipt does not match the signed delivery.",
    );
  }
}
