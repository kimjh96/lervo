import {
  type OrganizationDeploymentPermission,
  type OrganizationDeploymentPolicy,
  validateSchema,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { canonicalHash, clone, contentId, isCanonicalOrder, timestamp } from "./shared.js";

export type OrganizationDeploymentPolicyContent = Omit<OrganizationDeploymentPolicy, "policyId">;

function normalizedPolicy(
  input: Omit<OrganizationDeploymentPolicyContent, "schemaVersion">,
): OrganizationDeploymentPolicyContent {
  return {
    schemaVersion: 1,
    ...clone(input),
    tenancy: {
      ...clone(input.tenancy),
      projects: [...input.tenancy.projects].sort((left, right) =>
        left.projectId.localeCompare(right.projectId),
      ),
    },
    authorities: input.authorities
      .map((authority) => ({
        ...clone(authority),
        permissions: [...authority.permissions].sort(),
        projectIds: [...authority.projectIds].sort(),
      }))
      .sort((left, right) => left.principalId.localeCompare(right.principalId)),
    credentialPolicy: {
      ...clone(input.credentialPolicy),
      allowedPermissions: [...input.credentialPolicy.allowedPermissions].sort(),
    },
  };
}

export function calculateOrganizationDeploymentPolicyId(
  content: OrganizationDeploymentPolicyContent,
): string {
  return contentId("odp", content);
}

export function calculateOrganizationDeploymentPolicyHash(
  policy: OrganizationDeploymentPolicy,
): string {
  assertOrganizationDeploymentPolicy(policy);
  return canonicalHash(policy);
}

export function createOrganizationDeploymentPolicy(
  input: Omit<OrganizationDeploymentPolicyContent, "schemaVersion">,
): OrganizationDeploymentPolicy {
  const content = normalizedPolicy(input);
  const policy: OrganizationDeploymentPolicy = {
    ...content,
    policyId: calculateOrganizationDeploymentPolicyId(content),
  };
  assertOrganizationDeploymentPolicy(policy);
  return clone(policy);
}

function canonicalPolicyCollections(policy: OrganizationDeploymentPolicy): boolean {
  const projectIds = policy.tenancy.projects.map((project) => project.projectId);
  const principalIds = policy.authorities.map((authority) => authority.principalId);
  return (
    isCanonicalOrder(projectIds) &&
    isCanonicalOrder(principalIds) &&
    isCanonicalOrder(policy.credentialPolicy.allowedPermissions) &&
    policy.authorities.every(
      (authority) =>
        isCanonicalOrder(authority.permissions) && isCanonicalOrder(authority.projectIds),
    )
  );
}

function completeProjectAuthority(policy: OrganizationDeploymentPolicy): boolean {
  return policy.tenancy.projects.every((project) => {
    const issuers = policy.authorities.filter(
      (authority) =>
        authority.projectIds.includes(project.projectId) &&
        authority.permissions.includes("credential.issue"),
    );
    const deliverers = policy.authorities.filter(
      (authority) =>
        authority.projectIds.includes(project.projectId) &&
        authority.permissions.includes("credential.deliver"),
    );
    return issuers.some((issuer) =>
      deliverers.some((deliverer) => deliverer.principalId !== issuer.principalId),
    );
  });
}

export function assertOrganizationDeploymentPolicy(policy: OrganizationDeploymentPolicy): void {
  if (!validateSchema("organizationDeploymentPolicy", policy).valid) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy",
      "The organization deployment policy contract is invalid.",
    );
  }
  const { policyId: _policyId, ...content } = policy;
  const knownProjects = new Set(policy.tenancy.projects.map((project) => project.projectId));
  if (
    policy.policyId !== calculateOrganizationDeploymentPolicyId(content) ||
    timestamp(policy.expiresAt) <= timestamp(policy.issuedAt) ||
    (policy.sequence === 1 && policy.previousPolicyId !== null) ||
    (policy.sequence > 1 && policy.previousPolicyId === null) ||
    policy.previousPolicyId === policy.policyId ||
    !canonicalPolicyCollections(policy) ||
    policy.authorities.some((authority) =>
      authority.projectIds.some((projectId) => !knownProjects.has(projectId)),
    ) ||
    !completeProjectAuthority(policy)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_organization_policy",
      "The organization deployment policy identity, tenancy, authority, or interval is invalid.",
    );
  }
}

export function assertOrganizationAuthority(input: {
  policy: OrganizationDeploymentPolicy;
  principalId: string;
  permission: OrganizationDeploymentPermission;
  projectId: string;
  at: string;
}): void {
  assertOrganizationDeploymentPolicy(input.policy);
  const at = timestamp(input.at);
  const projectKnown = input.policy.tenancy.projects.some(
    (project) => project.projectId === input.projectId,
  );
  const authority = input.policy.authorities.find(
    (candidate) => candidate.principalId === input.principalId,
  );
  if (
    !Number.isFinite(at) ||
    at < timestamp(input.policy.issuedAt) ||
    at >= timestamp(input.policy.expiresAt) ||
    !projectKnown ||
    authority === undefined ||
    !authority.permissions.includes(input.permission) ||
    !authority.projectIds.includes(input.projectId)
  ) {
    throw new OrganizationDeploymentError(
      "organization_authority_denied",
      "The organization deployment authority does not cover this project operation.",
    );
  }
}
