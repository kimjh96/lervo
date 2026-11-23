import { expect, it } from "vitest";

import {
  assertOrganizationRuntimeIdentity,
  externalAgentDeploymentConfigHash,
  legacyExternalAgentDeploymentConfigHash,
  organizationIdentityHash,
  type AgentOrganizationProjection,
} from "../src/index.js";

const deployment = {
  platform: "discord",
  integrationId: "discord-main",
  agentId: "agt_1",
  participantId: "participant_1",
  command: { provider: "claude", roleId: "developer" },
  conversations: [
    { tenantKeyHash: "sha256:a", conversationKeyHash: "sha256:b", conversationId: "conv_1" },
  ],
};

it("leaves the response model out of the deployment hash (ADR-0612)", () => {
  const current = externalAgentDeploymentConfigHash(deployment);
  const before = legacyExternalAgentDeploymentConfigHash({
    ...deployment,
    response: { provider: "claude", model: "claude-opus-5-5" },
  });
  const otherModel = legacyExternalAgentDeploymentConfigHash({
    ...deployment,
    response: { provider: "claude", model: "claude-sonnet-5-5" },
  });
  expect(current).not.toBe(before);
  expect(before).not.toBe(otherModel);
  // The pre-ADR-0612 hash is unchanged, so a deployment bound earlier still matches it.
  expect(
    legacyExternalAgentDeploymentConfigHash({
      ...deployment,
      response: { provider: "claude", model: "claude-opus-5-5" },
    }),
  ).toBe(before);
  expect(externalAgentDeploymentConfigHash({ ...deployment, agentId: "agt_2" })).not.toBe(current);
});

it("keeps the pre-ADR-0612 hash byte for byte, so bound deployments still validate", () => {
  const response = { provider: "claude", model: null };
  // The exact formula deployments were bound with before ADR-0612.
  const bound = organizationIdentityHash({ schemaVersion: 1, ...deployment, response });
  expect(legacyExternalAgentDeploymentConfigHash({ ...deployment, response })).toBe(bound);
});

it("accepts a deployment still bound with the pre-ADR-0612 hash of its configuration", () => {
  const response = { provider: "claude", model: "claude-opus-5-5" };
  const legacy = legacyExternalAgentDeploymentConfigHash({ ...deployment, response });
  const identity = {
    organizationId: "org_1",
    teamId: "team_1",
    projectId: "prj_1",
    repositoryIdentityHash: "sha256:r",
    agentId: deployment.agentId,
    participantId: deployment.participantId,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: "sha256:c",
    roleProfileHash: "sha256:p",
    providerPolicyHash: "sha256:policy",
    platform: "discord",
    integrationId: deployment.integrationId,
    externalPrincipalHash: "sha256:principal",
    deploymentConfigHash: externalAgentDeploymentConfigHash(deployment),
    conversations: deployment.conversations,
  };
  const projection = {
    projectId: "prj_1",
    team: { organizationId: "org_1", teamId: "team_1", repositoryIdentityHash: "sha256:r" },
    memberships: [
      {
        membershipId: "mem_1",
        status: "active",
        agentId: identity.agentId,
        roleId: identity.roleId,
        roleVersion: identity.roleVersion,
        roleContractHash: identity.roleContractHash,
        roleProfileHash: identity.roleProfileHash,
        providerPolicyHash: identity.providerPolicyHash,
      },
    ],
    deployments: [
      {
        deploymentId: "adep_1",
        retiredAt: null,
        membershipId: "mem_1",
        agentId: identity.agentId,
        participantId: identity.participantId,
        platform: "discord",
        integrationId: identity.integrationId,
        externalPrincipalHash: identity.externalPrincipalHash,
        deploymentConfigHash: legacy,
      },
    ],
    channelMemberships: [
      {
        channelMembershipId: "chm_1",
        status: "active",
        deploymentId: "adep_1",
        ...deployment.conversations[0],
      },
    ],
  } as unknown as AgentOrganizationProjection;
  expect(() => assertOrganizationRuntimeIdentity(projection, identity)).toThrow(
    "no exact active external-agent deployment",
  );
  expect(
    assertOrganizationRuntimeIdentity(projection, {
      ...identity,
      legacyDeploymentConfigHashes: [legacy],
    }),
  ).toMatchObject({ deploymentId: "adep_1", channelMembershipIds: ["chm_1"] });
});
