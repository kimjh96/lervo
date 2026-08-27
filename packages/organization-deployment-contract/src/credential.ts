import {
  type OrganizationDeploymentPolicy,
  type OrganizationRuntimeCredentialGrant,
  type OrganizationRuntimeCredentialRevocation,
  validateSchema,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import {
  assertOrganizationAuthority,
  assertOrganizationDeploymentPolicy,
  calculateOrganizationDeploymentPolicyHash,
} from "./policy.js";
import { canonicalHash, clone, contentId, isCanonicalOrder, timestamp } from "./shared.js";

type CredentialGrantContent = Omit<OrganizationRuntimeCredentialGrant, "credentialId">;
type CredentialRevocationContent = Omit<OrganizationRuntimeCredentialRevocation, "revocationId">;

function sameTarget(
  left: OrganizationRuntimeCredentialGrant,
  right: OrganizationRuntimeCredentialGrant,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.target.projectId === right.target.projectId &&
    left.target.projectIdentityHash === right.target.projectIdentityHash &&
    left.nodeId === right.nodeId &&
    left.destinationId === right.destinationId &&
    left.subjectPrincipalId === right.subjectPrincipalId
  );
}

export function calculateOrganizationRuntimeCredentialId(content: CredentialGrantContent): string {
  return contentId("ocg", content);
}

export function assertOrganizationRuntimeCredentialGrant(
  grant: OrganizationRuntimeCredentialGrant,
): void {
  if (!validateSchema("organizationRuntimeCredentialGrant", grant).valid) {
    throw new OrganizationDeploymentError(
      "invalid_credential_grant",
      "The organization runtime credential grant contract is invalid.",
    );
  }
  const { credentialId: _credentialId, ...content } = grant;
  if (
    grant.credentialId !== calculateOrganizationRuntimeCredentialId(content) ||
    !isCanonicalOrder(grant.permissions) ||
    timestamp(grant.notBefore) < timestamp(grant.issuedAt) ||
    timestamp(grant.expiresAt) <= timestamp(grant.notBefore) ||
    (grant.generation === 1 && grant.previousCredentialId !== null) ||
    (grant.generation > 1 && grant.previousCredentialId === null) ||
    grant.previousCredentialId === grant.credentialId
  ) {
    throw new OrganizationDeploymentError(
      "invalid_credential_grant",
      "The organization runtime credential identity, generation, or interval is invalid.",
    );
  }
}

export function createOrganizationRuntimeCredentialGrant(input: {
  policy: OrganizationDeploymentPolicy;
  target: OrganizationRuntimeCredentialGrant["target"];
  nodeId: string;
  destinationId: string;
  subjectPrincipalId: string;
  permissions: OrganizationRuntimeCredentialGrant["permissions"];
  issuedBy: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  previous?: OrganizationRuntimeCredentialGrant;
}): OrganizationRuntimeCredentialGrant {
  assertOrganizationDeploymentPolicy(input.policy);
  const project = input.policy.tenancy.projects.find(
    (candidate) => candidate.projectId === input.target.projectId,
  );
  const permission = input.previous === undefined ? "credential.issue" : "credential.rotate";
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.issuedBy,
    permission,
    projectId: input.target.projectId,
    at: input.issuedAt,
  });
  const permissions = [...input.permissions].sort();
  const ttlSeconds = (timestamp(input.expiresAt) - timestamp(input.notBefore)) / 1_000;
  if (
    project === undefined ||
    project.projectIdentityHash !== input.target.projectIdentityHash ||
    permissions.some(
      (candidate) => !input.policy.credentialPolicy.allowedPermissions.includes(candidate),
    ) ||
    ttlSeconds > input.policy.credentialPolicy.maximumTtlSeconds ||
    timestamp(input.expiresAt) > timestamp(input.policy.expiresAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_credential_grant",
      "The runtime credential target, permission, or lifetime exceeds organization policy.",
    );
  }
  if (input.previous !== undefined) {
    assertOrganizationRuntimeCredentialGrant(input.previous);
    const overlapSeconds =
      (timestamp(input.previous.expiresAt) - timestamp(input.notBefore)) / 1_000;
    if (
      !sameTarget(input.previous, {
        ...input.previous,
        organizationId: input.policy.organizationId,
        target: input.target,
        nodeId: input.nodeId,
        destinationId: input.destinationId,
        subjectPrincipalId: input.subjectPrincipalId,
      }) ||
      timestamp(input.issuedAt) < timestamp(input.previous.issuedAt) ||
      overlapSeconds < 0 ||
      overlapSeconds > input.policy.credentialPolicy.maximumRotationOverlapSeconds
    ) {
      throw new OrganizationDeploymentError(
        "invalid_credential_grant",
        "The runtime credential rotation target, order, or overlap is invalid.",
      );
    }
  }
  const content: CredentialGrantContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    policyHash: calculateOrganizationDeploymentPolicyHash(input.policy),
    target: clone(input.target),
    nodeId: input.nodeId,
    destinationId: input.destinationId,
    subjectPrincipalId: input.subjectPrincipalId,
    permissions,
    generation: (input.previous?.generation ?? 0) + 1,
    previousCredentialId: input.previous?.credentialId ?? null,
    issuedBy: input.issuedBy,
    issuedAt: input.issuedAt,
    notBefore: input.notBefore,
    expiresAt: input.expiresAt,
    material: "runtime_only",
  };
  const grant: OrganizationRuntimeCredentialGrant = {
    ...content,
    credentialId: calculateOrganizationRuntimeCredentialId(content),
  };
  assertOrganizationRuntimeCredentialGrant(grant);
  return clone(grant);
}

export function assertCredentialGrantAgainstPolicy(input: {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
}): void {
  assertOrganizationDeploymentPolicy(input.policy);
  assertOrganizationRuntimeCredentialGrant(input.grant);
  const project = input.policy.tenancy.projects.find(
    (candidate) => candidate.projectId === input.grant.target.projectId,
  );
  if (
    input.grant.organizationId !== input.policy.organizationId ||
    input.grant.policyId !== input.policy.policyId ||
    input.grant.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
    project?.projectIdentityHash !== input.grant.target.projectIdentityHash ||
    input.grant.permissions.some(
      (permission) => !input.policy.credentialPolicy.allowedPermissions.includes(permission),
    ) ||
    timestamp(input.grant.expiresAt) > timestamp(input.policy.expiresAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_credential_grant",
      "The runtime credential grant is not bound to this organization policy.",
    );
  }
}

export function createOrganizationRuntimeCredentialRevocation(input: {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
  revokedBy: string;
  revokedAt: string;
  reason: OrganizationRuntimeCredentialRevocation["reason"];
}): OrganizationRuntimeCredentialRevocation {
  assertCredentialGrantAgainstPolicy(input);
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.revokedBy,
    permission: "credential.revoke",
    projectId: input.grant.target.projectId,
    at: input.revokedAt,
  });
  const content: CredentialRevocationContent = {
    schemaVersion: 1,
    organizationId: input.policy.organizationId,
    policyId: input.policy.policyId,
    policyHash: calculateOrganizationDeploymentPolicyHash(input.policy),
    credentialId: input.grant.credentialId,
    revokedBy: input.revokedBy,
    revokedAt: input.revokedAt,
    reason: input.reason,
  };
  const revocation: OrganizationRuntimeCredentialRevocation = {
    ...content,
    revocationId: contentId("ocr", content),
  };
  assertOrganizationRuntimeCredentialRevocation({
    policy: input.policy,
    grant: input.grant,
    revocation,
  });
  return clone(revocation);
}

export function assertOrganizationRuntimeCredentialRevocation(input: {
  policy: OrganizationDeploymentPolicy;
  grant: OrganizationRuntimeCredentialGrant;
  revocation: OrganizationRuntimeCredentialRevocation;
}): void {
  assertCredentialGrantAgainstPolicy(input);
  if (!validateSchema("organizationRuntimeCredentialRevocation", input.revocation).valid) {
    throw new OrganizationDeploymentError(
      "invalid_credential_revocation",
      "The organization runtime credential revocation contract is invalid.",
    );
  }
  const { revocationId: _revocationId, ...content } = input.revocation;
  if (
    input.revocation.revocationId !== contentId("ocr", content) ||
    input.revocation.organizationId !== input.policy.organizationId ||
    input.revocation.policyId !== input.policy.policyId ||
    input.revocation.policyHash !== calculateOrganizationDeploymentPolicyHash(input.policy) ||
    input.revocation.credentialId !== input.grant.credentialId ||
    timestamp(input.revocation.revokedAt) < timestamp(input.grant.issuedAt)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_credential_revocation",
      "The credential revocation identity, policy, credential, or time binding is invalid.",
    );
  }
}

export function calculateOrganizationRuntimeCredentialHash(
  grant: OrganizationRuntimeCredentialGrant,
): string {
  assertOrganizationRuntimeCredentialGrant(grant);
  return canonicalHash(grant);
}
