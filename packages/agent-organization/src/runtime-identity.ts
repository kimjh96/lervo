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

export function externalAgentDeploymentConfigHash(input: {
  platform: string;
  integrationId: string;
  agentId: string;
  participantId: string;
  response: { provider: string; model: string | null };
  command: { provider: string; roleId: string };
  conversations: readonly {
    tenantKeyHash: string;
    conversationKeyHash: string;
    conversationId: string;
  }[];
}): string {
  return organizationIdentityHash({
    schemaVersion: 1,
    ...input,
    conversations: [...input.conversations].sort((left, right) =>
      left.conversationId.localeCompare(right.conversationId),
    ),
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
      item.deploymentConfigHash === identity.deploymentConfigHash,
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
