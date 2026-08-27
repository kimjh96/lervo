import {
  type OrganizationDeploymentPolicy,
  type OrganizationNodeEnrollment,
  type OrganizationRuntimeCredentialDeliveryReceipt,
  type OrganizationRuntimeCredentialGrant,
  type OrganizationRuntimeCredentialRevocation,
  validateSchema,
} from "@lervo/schemas";

import {
  assertCredentialGrantAgainstPolicy,
  assertOrganizationRuntimeCredentialRevocation,
} from "./credential.js";
import { OrganizationDeploymentError } from "./errors.js";
import {
  assertOrganizationAuthority,
  calculateOrganizationDeploymentPolicyHash,
} from "./policy.js";
import { canonicalHash, clone, contentId, timestamp } from "./shared.js";

type EnrollmentContent = Omit<OrganizationNodeEnrollment, "enrollmentId">;

function assertCredentialDeliveryReceipt(
  grant: OrganizationRuntimeCredentialGrant,
  receipt: OrganizationRuntimeCredentialDeliveryReceipt,
): void {
  const { deliveryId: _deliveryId, ...content } = receipt;
  if (
    !validateSchema("organizationRuntimeCredentialDeliveryReceipt", receipt).valid ||
    receipt.deliveryId !== contentId("ocd", content) ||
    receipt.organizationId !== grant.organizationId ||
    receipt.policyId !== grant.policyId ||
    receipt.credentialId !== grant.credentialId ||
    receipt.target.projectId !== grant.target.projectId ||
    receipt.target.projectIdentityHash !== grant.target.projectIdentityHash ||
    receipt.nodeId !== grant.nodeId ||
    receipt.destinationId !== grant.destinationId ||
    receipt.generation !== grant.generation
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_enrollment",
      "The credential delivery receipt does not bind the enrollment target.",
    );
  }
}

function readinessEstablished(readiness: OrganizationNodeEnrollment["readiness"]): boolean {
  return (
    readiness.status === "ready" &&
    readiness.consecutiveObservations === 3 &&
    readiness.sync === "ready" &&
    readiness.workstreamReplication === "ready" &&
    (readiness.workspaceCoordination === "ready" ||
      readiness.workspaceCoordination === "disabled") &&
    (readiness.remoteControl === "ready" || readiness.remoteControl === "disabled")
  );
}

export function calculateOrganizationNodeEnrollmentHash(
  enrollment: OrganizationNodeEnrollment,
): string {
  assertOrganizationNodeEnrollment(enrollment);
  return canonicalHash(enrollment);
}

export function assertOrganizationNodeEnrollment(enrollment: OrganizationNodeEnrollment): void {
  if (!validateSchema("organizationNodeEnrollment", enrollment).valid) {
    throw new OrganizationDeploymentError(
      "invalid_node_enrollment",
      "The organization Node enrollment contract is invalid.",
    );
  }
  const { enrollmentId: _enrollmentId, ...content } = enrollment;
  if (
    enrollment.enrollmentId !== contentId("one", content) ||
    !readinessEstablished(enrollment.readiness)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_enrollment",
      "The organization Node enrollment identity or readiness evidence is invalid.",
    );
  }
}

export function createOrganizationNodeEnrollment(input: {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
  deliveryReceipt: OrganizationRuntimeCredentialDeliveryReceipt;
  revocations?: OrganizationRuntimeCredentialRevocation[];
  serviceInstanceId: string;
  runtimeVersion: string;
  runtimeArtifactHash: string;
  localPlanId: string;
  localApplyReceiptHash: string;
  readiness: OrganizationNodeEnrollment["readiness"];
  enrolledBy: string;
  enrolledAt: string;
}): OrganizationNodeEnrollment {
  assertCredentialGrantAgainstPolicy({ policy: input.policy, grant: input.grant });
  assertCredentialDeliveryReceipt(input.grant, input.deliveryReceipt);
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.enrolledBy,
    permission: "node.enroll",
    projectId: input.grant.target.projectId,
    at: input.enrolledAt,
  });
  const enrolledAt = timestamp(input.enrolledAt);
  if (
    enrolledAt < timestamp(input.deliveryReceipt.deliveredAt) ||
    enrolledAt < timestamp(input.grant.notBefore) ||
    enrolledAt >= timestamp(input.grant.expiresAt) ||
    !readinessEstablished(input.readiness)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_enrollment",
      "The Node was not enrolled from active credentials and complete readiness evidence.",
    );
  }
  for (const revocation of input.revocations ?? []) {
    assertOrganizationRuntimeCredentialRevocation({
      policy: input.policy,
      grant: input.grant,
      revocation,
    });
    if (timestamp(revocation.revokedAt) <= enrolledAt) {
      throw new OrganizationDeploymentError(
        "credential_revoked",
        "The runtime credential was revoked before Node enrollment.",
      );
    }
  }
  const content: EnrollmentContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    policyHash: calculateOrganizationDeploymentPolicyHash(input.policy),
    target: clone(input.grant.target),
    nodeId: input.grant.nodeId,
    destinationId: input.grant.destinationId,
    serviceInstanceId: input.serviceInstanceId,
    runtimeVersion: input.runtimeVersion,
    runtimeArtifactHash: input.runtimeArtifactHash,
    credentialId: input.grant.credentialId,
    credentialDeliveryId: input.deliveryReceipt.deliveryId,
    localPlanId: input.localPlanId,
    localApplyReceiptHash: input.localApplyReceiptHash,
    readiness: clone(input.readiness),
    enrolledBy: input.enrolledBy,
    enrolledAt: input.enrolledAt,
    secretMaterial: "excluded",
  };
  const enrollment: OrganizationNodeEnrollment = {
    ...content,
    enrollmentId: contentId("one", content),
  };
  assertOrganizationNodeEnrollment(enrollment);
  return clone(enrollment);
}
