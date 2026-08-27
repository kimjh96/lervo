import type {
  OrganizationNodeRolloutDelivery,
  OrganizationProjectTarget,
  SignedOrganizationNodeRolloutDelivery,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import {
  assertSignedOrganizationNodeRolloutDelivery,
  organizationNodeRolloutDeliverySigningBytes,
  organizationNodeRolloutSignatureBytes,
} from "./rollout-delivery-integrity.js";
import {
  assertSignedOrganizationDeploymentPolicy,
  organizationDeploymentPolicySigningBytes,
} from "./signature.js";

export type TrustedOrganizationNodeRolloutSigner =
  | {
      purpose: "policy";
      keyId: string;
      organizationIds: string[];
      projects: OrganizationProjectTarget[];
      verify(input: { message: Uint8Array; signature: Uint8Array }): Promise<boolean>;
    }
  | {
      purpose: "approval";
      keyId: string;
      principalId: string;
      organizationIds: string[];
      projects: OrganizationProjectTarget[];
      verify(input: { message: Uint8Array; signature: Uint8Array }): Promise<boolean>;
    };

export interface OrganizationNodeRolloutDeliveryTrustStore {
  find(input: {
    purpose: TrustedOrganizationNodeRolloutSigner["purpose"];
    keyId: string;
  }): Promise<TrustedOrganizationNodeRolloutSigner | null>;
}

function sameTarget(left: OrganizationProjectTarget, right: OrganizationProjectTarget): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function assertDeliveryContext(delivery: OrganizationNodeRolloutDelivery): void {
  const policy = delivery.signedPolicy.policy;
  if (
    policy.organizationId !== delivery.approval.organizationId ||
    policy.policyId !== delivery.approval.policyId ||
    !sameTarget(delivery.target, delivery.rolloutPlan.target) ||
    !sameTarget(delivery.target, delivery.enrollment.target) ||
    !sameTarget(delivery.target, delivery.executionPlan.target) ||
    delivery.nodeId !== delivery.enrollment.nodeId ||
    delivery.nodeId !== delivery.executionPlan.nodeId ||
    delivery.destinationId !== delivery.enrollment.destinationId ||
    delivery.destinationId !== delivery.executionPlan.destinationId
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The rollout delivery does not bind one exact policy, project, Node, and destination.",
    );
  }
}

function scopedSigner(input: {
  signer: TrustedOrganizationNodeRolloutSigner;
  purpose: TrustedOrganizationNodeRolloutSigner["purpose"];
  keyId: string;
  organizationId: string;
  target: OrganizationProjectTarget;
  principalId?: string;
}): boolean {
  return (
    input.signer.purpose === input.purpose &&
    input.signer.keyId === input.keyId &&
    input.signer.organizationIds.includes(input.organizationId) &&
    input.signer.projects.some((project) => sameTarget(project, input.target)) &&
    (input.purpose !== "approval" ||
      (input.signer.purpose === "approval" && input.signer.principalId === input.principalId))
  );
}

export async function verifyOrganizationNodeRolloutSigner(input: {
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
  purpose: TrustedOrganizationNodeRolloutSigner["purpose"];
  keyId: string;
  organizationId: string;
  target: OrganizationProjectTarget;
  principalId?: string;
  message: Uint8Array;
  signature: Uint8Array;
}): Promise<void> {
  let signer: TrustedOrganizationNodeRolloutSigner | null;
  try {
    signer = await input.trustStore.find({ purpose: input.purpose, keyId: input.keyId });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_trust_failed",
      "The organization rollout delivery trust store could not be read.",
      { cause: error },
    );
  }
  if (
    signer === null ||
    !scopedSigner({
      signer,
      purpose: input.purpose,
      keyId: input.keyId,
      organizationId: input.organizationId,
      target: input.target,
      ...(input.principalId === undefined ? {} : { principalId: input.principalId }),
    })
  ) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_signer_denied",
      "The organization rollout delivery signer is not trusted for this target.",
    );
  }
  let valid: boolean;
  try {
    valid = await signer.verify({ message: input.message, signature: input.signature });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery_signature",
      "The organization rollout delivery signature is invalid.",
    );
  }
}

export async function authorizeOrganizationNodeRolloutDelivery(input: {
  envelope: SignedOrganizationNodeRolloutDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
}): Promise<OrganizationNodeRolloutDelivery> {
  assertSignedOrganizationNodeRolloutDelivery(input.envelope);
  const delivery = input.envelope.delivery;
  assertSignedOrganizationDeploymentPolicy(delivery.signedPolicy);
  assertDeliveryContext(delivery);
  if (
    delivery.nodeId !== input.nodeId ||
    delivery.destinationId !== input.destinationId ||
    !sameTarget(delivery.target, input.target)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The rollout delivery target does not match the installed process binding.",
    );
  }
  await verifyOrganizationNodeRolloutSigner({
    trustStore: input.trustStore,
    purpose: "policy",
    keyId: delivery.signedPolicy.signature.keyId,
    organizationId: delivery.signedPolicy.policy.organizationId,
    target: delivery.target,
    message: organizationDeploymentPolicySigningBytes({
      policy: delivery.signedPolicy.policy,
      keyId: delivery.signedPolicy.signature.keyId,
    }),
    signature: organizationNodeRolloutSignatureBytes(delivery.signedPolicy.signature.value),
  });
  await verifyOrganizationNodeRolloutSigner({
    trustStore: input.trustStore,
    purpose: "approval",
    keyId: input.envelope.signature.keyId,
    organizationId: delivery.approval.organizationId,
    target: delivery.target,
    principalId: delivery.approval.approvedBy,
    message: organizationNodeRolloutDeliverySigningBytes({
      delivery,
      keyId: input.envelope.signature.keyId,
    }),
    signature: organizationNodeRolloutSignatureBytes(input.envelope.signature.value),
  });
  return delivery;
}
