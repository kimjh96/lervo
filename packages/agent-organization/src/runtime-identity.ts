import { createHash } from "node:crypto";

import type { AgentOrganizationProjection } from "./types.js";
import { AgentOrganizationError } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function organizationIdentityHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function workforceProviderPolicyHash(provider: "codex" | "claude" | "any"): string {
  return organizationIdentityHash({ schemaVersion: 1, provider });
}

export function workforceProviderForPolicyHash(
  providerPolicyHash: string,
): "codex" | "claude" | "any" | null {
  for (const provider of ["codex", "claude", "any"] as const) {
    if (workforceProviderPolicyHash(provider) === providerPolicyHash) return provider;
  }
  return null;
}

export function externalAgentPrincipalHash(platform: string, externalPrincipalId: string): string {
  return organizationIdentityHash({ schemaVersion: 1, platform, externalPrincipalId });
}

export function externalConversationKeyHash(input: {
  platform: string;
  kind: "tenant" | "conversation";
  key: string;
}): string {
  return organizationIdentityHash({ schemaVersion: 1, ...input });
}

interface ExternalAgentDeploymentConfig {
  platform: string;
  integrationId: string;
  agentId: string;
  participantId: string;
  command: { provider: string; roleId: string };
  conversations: readonly {
    tenantKeyHash: string;
    conversationKeyHash: string;
    conversationId: string;
  }[];
}

function sortedConversations(input: ExternalAgentDeploymentConfig) {
  return [...input.conversations].sort((left, right) =>
    left.conversationId.localeCompare(right.conversationId),
  );
}

/**
 * ADR-0612: the deployment covers the agent's identity, command provider, and conversations, not
 * the response model, which the model selection chooses at each call. A model change therefore
 * never orphans a deployment.
 */
export function externalAgentDeploymentConfigHash(input: ExternalAgentDeploymentConfig): string {
  return organizationIdentityHash({
    schemaVersion: 2,
    platform: input.platform,
    integrationId: input.integrationId,
    agentId: input.agentId,
    participantId: input.participantId,
    command: input.command,
    conversations: sortedConversations(input),
  });
}

/**
 * The hash a deployment bound before ADR-0612 carries, which also covered the configured response
 * provider and model. A running Node still matches it until the deployment is next bound.
 */
export function legacyExternalAgentDeploymentConfigHash(
  input: ExternalAgentDeploymentConfig & { response: { provider: string; model: string | null } },
): string {
  return organizationIdentityHash({
    schemaVersion: 1,
    platform: input.platform,
    integrationId: input.integrationId,
    agentId: input.agentId,
    participantId: input.participantId,
    response: input.response,
    command: input.command,
    conversations: sortedConversations(input),
  });
}

export interface OrganizationRuntimeIdentity {
  organizationId: string;
  teamId: string;
  projectId: string;
  repositoryIdentityHash: string;
  agentId: string;
  participantId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  roleProfileHash: string;
  providerPolicyHash: string;
  platform: string;
  integrationId: string;
  externalPrincipalHash: string;
  deploymentConfigHash: string;
  /** Earlier hashes of the same configuration a deployment may still carry (ADR-0612). */
  legacyDeploymentConfigHashes?: readonly string[];
  conversations: readonly {
    tenantKeyHash: string;
    conversationKeyHash: string;
    conversationId: string;
  }[];
}

export function assertOrganizationRuntimeIdentity(
  projection: AgentOrganizationProjection,
  identity: OrganizationRuntimeIdentity,
): { membershipId: string; deploymentId: string; channelMembershipIds: string[] } {
  if (
    projection.team === null ||
    projection.team.organizationId !== identity.organizationId ||
    projection.team.teamId !== identity.teamId ||
    projection.projectId !== identity.projectId ||
    projection.team.repositoryIdentityHash !== identity.repositoryIdentityHash
  ) {
    throw new AgentOrganizationError(
      "organization_identity_conflict",
      "The runtime does not match this repository's organization team.",
    );
  }
  const membership = projection.memberships.find(
    (item) =>
      item.status === "active" &&
      item.agentId === identity.agentId &&
      item.roleId === identity.roleId &&
      item.roleVersion === identity.roleVersion &&
      item.roleContractHash === identity.roleContractHash &&
      item.roleProfileHash === identity.roleProfileHash &&
      item.providerPolicyHash === identity.providerPolicyHash,
  );
  if (membership === undefined) {
    throw new AgentOrganizationError(
      "organization_identity_conflict",
      "The runtime has no exact active hired-agent membership.",
    );
  }
  const deployment = projection.deployments.find(
    (item) =>
      item.retiredAt === null &&
      item.membershipId === membership.membershipId &&
      item.agentId === identity.agentId &&
      item.participantId === identity.participantId &&
      item.platform === identity.platform &&
      item.integrationId === identity.integrationId &&
      item.externalPrincipalHash === identity.externalPrincipalHash &&
      (item.deploymentConfigHash === identity.deploymentConfigHash ||
        (identity.legacyDeploymentConfigHashes ?? []).includes(item.deploymentConfigHash)),
  );
  if (deployment === undefined) {
    throw new AgentOrganizationError(
      "organization_identity_conflict",
      "The runtime has no exact active external-agent deployment.",
    );
  }
  const channelMembershipIds = identity.conversations.map((conversation) => {
    const channel = projection.channelMemberships.find(
      (item) =>
        item.status === "active" &&
        item.deploymentId === deployment.deploymentId &&
        item.tenantKeyHash === conversation.tenantKeyHash &&
        item.conversationKeyHash === conversation.conversationKeyHash &&
        item.conversationId === conversation.conversationId,
    );
    if (channel === undefined) {
      throw new AgentOrganizationError(
        "organization_identity_conflict",
        "The runtime has no exact active channel membership.",
      );
    }
    return channel.channelMembershipId;
  });
  return {
    membershipId: membership.membershipId,
    deploymentId: deployment.deploymentId,
    channelMembershipIds,
  };
}
