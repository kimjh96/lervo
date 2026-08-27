import { canonicalJson } from "@lervo/event-contract";
import {
  type OrganizationNodeRolloutDelivery,
  type OrganizationNodeRolloutDeliveryReceipt,
  type OrganizationNodeRolloutExecutionReceipt,
  type SignedOrganizationNodeRolloutDelivery,
  validateSchema,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { calculateOrganizationNodeRolloutExecutionPlanHash } from "./rollout-execution.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

type DeliveryContent = Omit<OrganizationNodeRolloutDelivery, "deliveryId">;
type DeliveryReceiptContent = Omit<OrganizationNodeRolloutDeliveryReceipt, "deliveryReceiptId">;

export function organizationNodeRolloutSignatureBytes(value: string): Uint8Array {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 64 || bytes.toString("base64url") !== value) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_signature",
      "The organization rollout delivery signature encoding is invalid.",
    );
  }
  return bytes;
}

export function calculateOrganizationNodeRolloutDeliveryId(content: DeliveryContent): string {
  return contentId("oxd", content);
}

export function calculateOrganizationNodeRolloutDeliveryHash(
  delivery: OrganizationNodeRolloutDelivery,
): string {
  assertOrganizationNodeRolloutDelivery(delivery);
  return canonicalHash(delivery);
}

export function createOrganizationNodeRolloutDelivery(
  input: Omit<DeliveryContent, "schemaVersion" | "effect" | "secretMaterial">,
): OrganizationNodeRolloutDelivery {
  const content: DeliveryContent = {
    schemaVersion: 1,
    ...clone(input),
    effect: { deployment: "not_executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const delivery: OrganizationNodeRolloutDelivery = {
    ...content,
    deliveryId: calculateOrganizationNodeRolloutDeliveryId(content),
  };
  assertOrganizationNodeRolloutDelivery(delivery);
  return clone(delivery);
}

export function assertOrganizationNodeRolloutDelivery(
  delivery: OrganizationNodeRolloutDelivery,
): void {
  if (!validateSchema("organizationNodeRolloutDelivery", delivery).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The organization Node rollout delivery contract is invalid.",
    );
  }
  const { deliveryId: _deliveryId, ...content } = delivery;
  if (
    delivery.deliveryId !== calculateOrganizationNodeRolloutDeliveryId(content) ||
    timestamp(delivery.expiresAt) <= timestamp(delivery.issuedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The organization Node rollout delivery identity or interval is invalid.",
    );
  }
}

export function organizationNodeRolloutDeliverySigningBytes(input: {
  delivery: OrganizationNodeRolloutDelivery;
  keyId: string;
}): Uint8Array {
  assertOrganizationNodeRolloutDelivery(input.delivery);
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u.test(input.keyId)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_signature",
      "The organization rollout delivery signature key ID is invalid.",
    );
  }
  return Buffer.from(
    canonicalJson({
      domain: "lervo.organization-node-rollout.delivery.v1",
      algorithm: "ed25519",
      keyId: input.keyId,
      delivery: clone(input.delivery),
    }),
    "utf8",
  );
}

export function createSignedOrganizationNodeRolloutDelivery(input: {
  delivery: OrganizationNodeRolloutDelivery;
  keyId: string;
  signature: Uint8Array;
}): SignedOrganizationNodeRolloutDelivery {
  if (input.signature.byteLength !== 64) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_signature",
      "An organization rollout delivery Ed25519 signature must be 64 bytes.",
    );
  }
  const envelope: SignedOrganizationNodeRolloutDelivery = {
    schemaVersion: 1,
    delivery: clone(input.delivery),
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: Buffer.from(input.signature).toString("base64url"),
    },
  };
  assertSignedOrganizationNodeRolloutDelivery(envelope);
  return clone(envelope);
}

export function assertSignedOrganizationNodeRolloutDelivery(
  envelope: SignedOrganizationNodeRolloutDelivery,
): void {
  if (!validateSchema("signedOrganizationNodeRolloutDelivery", envelope).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_signature",
      "The signed organization Node rollout delivery contract is invalid.",
    );
  }
  assertOrganizationNodeRolloutDelivery(envelope.delivery);
  organizationNodeRolloutSignatureBytes(envelope.signature.value);
}

export function assertOrganizationNodeRolloutDeliveryReceipt(
  receipt: OrganizationNodeRolloutDeliveryReceipt,
): void {
  if (!validateSchema("organizationNodeRolloutDeliveryReceipt", receipt).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_receipt",
      "The organization Node rollout delivery receipt contract is invalid.",
    );
  }
  const { deliveryReceiptId: _deliveryReceiptId, ...content } = receipt;
  if (receipt.deliveryReceiptId !== contentId("odr", content)) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_receipt",
      "The organization Node rollout delivery receipt identity is invalid.",
    );
  }
}

export function createOrganizationNodeRolloutDeliveryReceipt(input: {
  delivery: OrganizationNodeRolloutDelivery;
  executionReceipt: OrganizationNodeRolloutExecutionReceipt;
}): OrganizationNodeRolloutDeliveryReceipt {
  assertOrganizationNodeRolloutDelivery(input.delivery);
  if (
    input.executionReceipt.executionPlanId !== input.delivery.executionPlan.executionPlanId ||
    input.executionReceipt.executionPlanHash !==
      calculateOrganizationNodeRolloutExecutionPlanHash(input.delivery.executionPlan)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_receipt",
      "The execution receipt does not match the signed rollout delivery.",
    );
  }
  const content: DeliveryReceiptContent = {
    schemaVersion: 1,
    deliveryId: input.delivery.deliveryId,
    deliveryHash: calculateOrganizationNodeRolloutDeliveryHash(input.delivery),
    idempotencyKey: input.delivery.idempotencyKey,
    executionReceipt: clone(input.executionReceipt),
    completedAt: input.executionReceipt.completedAt,
    effect: { deployment: "executed", rollback: "not_executed" },
    secretMaterial: "excluded",
  };
  const receipt: OrganizationNodeRolloutDeliveryReceipt = {
    ...content,
    deliveryReceiptId: contentId("odr", content),
  };
  assertOrganizationNodeRolloutDeliveryReceipt(receipt);
  return clone(receipt);
}
