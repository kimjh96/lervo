import type {
  OrganizationNodeRollbackDelivery,
  OrganizationProjectTarget,
  SignedOrganizationNodeRollbackDelivery,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import {
  type OrganizationNodeRolloutDeliveryTrustStore,
  verifyOrganizationNodeRolloutSigner,
} from "./rollout-delivery-authorization.js";
import { organizationNodeRolloutSignatureBytes } from "./rollout-delivery-integrity.js";
import {
  assertSignedOrganizationNodeRollbackDelivery,
  organizationNodeRollbackDeliverySigningBytes,
} from "./rollback-delivery-integrity.js";
import {
  assertSignedOrganizationDeploymentPolicy,
  organizationDeploymentPolicySigningBytes,
} from "./signature.js";

function sameTarget(left: OrganizationProjectTarget, right: OrganizationProjectTarget): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

export async function authorizeOrganizationNodeRollbackDelivery(input: {
  envelope: SignedOrganizationNodeRollbackDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
}): Promise<OrganizationNodeRollbackDelivery> {
  assertSignedOrganizationNodeRollbackDelivery(input.envelope);
  const delivery = input.envelope.delivery;
  const policy = delivery.signedPolicy.policy;
  assertSignedOrganizationDeploymentPolicy(delivery.signedPolicy);
  if (
    policy.organizationId !== delivery.approval.organizationId ||
    policy.policyId !== delivery.approval.policyId ||
    delivery.approval.action !== "rollback_wave" ||
    !sameTarget(delivery.target, input.target) ||
    !sameTarget(delivery.target, delivery.rolloutPlan.target) ||
    !sameTarget(delivery.target, delivery.enrollment.target) ||
    !sameTarget(delivery.target, delivery.rollbackPlan.target) ||
    delivery.nodeId !== input.nodeId ||
    delivery.nodeId !== delivery.enrollment.nodeId ||
    delivery.nodeId !== delivery.rollbackPlan.nodeId ||
    delivery.destinationId !== input.destinationId ||
    delivery.destinationId !== delivery.enrollment.destinationId ||
    delivery.destinationId !== delivery.rollbackPlan.destinationId
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The rollback delivery does not bind one exact policy, project, Node, and destination.",
    );
  }
  await verifyOrganizationNodeRolloutSigner({
    trustStore: input.trustStore,
    purpose: "policy",
    keyId: delivery.signedPolicy.signature.keyId,
    organizationId: policy.organizationId,
    target: delivery.target,
    message: organizationDeploymentPolicySigningBytes({
      policy,
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
    message: organizationNodeRollbackDeliverySigningBytes({
      delivery,
      keyId: input.envelope.signature.keyId,
    }),
    signature: organizationNodeRolloutSignatureBytes(input.envelope.signature.value),
  });
  return delivery;
}
