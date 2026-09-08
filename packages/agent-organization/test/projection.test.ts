import { describe, expect, it } from "vitest";

import {
  AgentOrganizationError,
  assertOrganizationRuntimeIdentity,
  projectAgentOrganization,
} from "../src/index.js";

const projectId = "prj_organization01";
const organizationId = "org_lervo0001";
const teamId = "team_lervo0001";
const agentId = `agt_${"a".repeat(24)}`;
const membershipId = "amem_lervoagent01";
const deploymentId = "adep_lervoagent01";
const channelMembershipId = "cmem_lervogeneral01";
const participantId = "ptc_lervoagent01";
const hash = (character: string) => `sha256:${character.repeat(64)}`;

const role = {
  roleId: "developer",
  roleVersion: "1.0.0",
  roleContractHash: hash("d"),
  roleProfileHash: hash("e"),
  providerPolicyHash: hash("f"),
};

function event(seq: number, type: string, payload: unknown) {
  return { projectId, seq, type, payload };
}

const team = event(1, "organization.team.bound", {
  organizationId,
  teamId,
  projectId,
  repositoryIdentityHash: hash("1"),
  organizationPolicyHash: hash("2"),
  teamPolicyHash: hash("3"),
  teamKind: "project",
  boundAt: "2026-09-08T00:00:00.000Z",
});

const membership = event(2, "organization.agent.membership.changed", {
  membershipId,
  organizationId,
  teamId,
  projectId,
  agentId,
  ...role,
  previousStatus: null,
  status: "active",
  revision: 1,
  changedAt: "2026-09-08T00:01:00.000Z",
});

const deployment = event(3, "organization.external_agent.deployment.bound", {
  deploymentId,
  organizationId,
  teamId,
  projectId,
  membershipId,
  agentId,
  participantId,
  ...role,
  platform: "discord",
  integrationId: "itg_discord01",
  externalPrincipalHash: hash("4"),
  deploymentConfigHash: hash("5"),
  boundAt: "2026-09-08T00:02:00.000Z",
});

const channel = event(4, "organization.channel.membership.changed", {
  channelMembershipId,
  deploymentId,
  organizationId,
  teamId,
  projectId,
  membershipId,
  agentId,
  participantId,
  platform: "discord",
  integrationId: "itg_discord01",
  tenantKeyHash: hash("6"),
  conversationKeyHash: hash("7"),
  conversationId: "cnv_lervogeneral01",
  previousStatus: null,
  status: "active",
  revision: 1,
  changedAt: "2026-09-08T00:03:00.000Z",
});

const deliberation = event(5, "organization.deliberation.participant.bound", {
  deliberationId: "dlb_organization01",
  deliberationPolicyHash: hash("8"),
  organizationId,
  teamId,
  projectId,
  channelMembershipId,
  membershipId,
  deploymentId,
  agentId,
  participantId,
  ...role,
  boundAt: "2026-09-08T00:04:00.000Z",
});

describe("agent organization projection", () => {
  it("accepts only the exact active runtime identity and channel set", () => {
    const projection = projectAgentOrganization({
      projectId,
      events: [team, membership, deployment, channel],
    });
    const identity = {
      organizationId,
      teamId,
      projectId,
      repositoryIdentityHash: hash("1"),
      agentId,
      participantId,
      ...role,
      platform: "discord",
      integrationId: "itg_discord01",
      externalPrincipalHash: hash("4"),
      deploymentConfigHash: hash("5"),
      conversations: [
        {
          tenantKeyHash: hash("6"),
          conversationKeyHash: hash("7"),
          conversationId: "cnv_lervogeneral01",
        },
      ],
    };
    expect(assertOrganizationRuntimeIdentity(projection, identity)).toEqual({
      membershipId,
      deploymentId,
      channelMembershipIds: [channelMembershipId],
    });
    expect(() =>
      assertOrganizationRuntimeIdentity(projection, {
        ...identity,
        externalPrincipalHash: hash("0"),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentOrganizationError>>({
        code: "organization_identity_conflict",
      }),
    );
  });

  it("preserves exact agent, role, external identity, channel, and deliberation history", () => {
    const projection = projectAgentOrganization({
      projectId,
      events: [
        team,
        membership,
        deployment,
        channel,
        deliberation,
        event(6, "organization.deliberation.participant.released", {
          deliberationId: "dlb_organization01",
          organizationId,
          teamId,
          projectId,
          agentId,
          participantId,
          outcomeId: `dlo_${"9".repeat(16)}`,
          status: "converged",
          releasedAt: "2026-09-08T00:05:00.000Z",
        }),
        event(7, "organization.channel.membership.changed", {
          ...(channel.payload as Record<string, unknown>),
          previousStatus: "active",
          status: "ended",
          revision: 2,
          changedAt: "2026-09-08T00:06:00.000Z",
        }),
        event(8, "organization.external_agent.deployment.retired", {
          deploymentId,
          organizationId,
          teamId,
          projectId,
          membershipId,
          agentId,
          reasonCode: "credential_rotated",
          retiredAt: "2026-09-08T00:07:00.000Z",
        }),
        event(9, "organization.agent.membership.changed", {
          ...(membership.payload as Record<string, unknown>),
          previousStatus: "active",
          status: "ended",
          revision: 2,
          changedAt: "2026-09-08T00:08:00.000Z",
        }),
      ],
    });

    expect(projection.team).toMatchObject({ organizationId, teamId, projectId });
    expect(projection.teamKindRevision).toBe(1);
    expect(projection.memberships).toEqual([
      expect.objectContaining({ membershipId, agentId, status: "ended", revision: 2 }),
    ]);
    expect(projection.deployments).toEqual([
      expect.objectContaining({
        deploymentId,
        participantId,
        retiredAt: "2026-09-08T00:07:00.000Z",
      }),
    ]);
    expect(projection.channelMemberships).toEqual([
      expect.objectContaining({ channelMembershipId, status: "ended", revision: 2 }),
    ]);
    expect(projection.deliberationParticipants).toEqual([
      expect.objectContaining({
        deliberationId: "dlb_organization01",
        agentId,
        outcomeStatus: "converged",
      }),
    ]);
  });

  it("reclassifies a team through explicit ordered history without changing its identity", () => {
    const projection = projectAgentOrganization({
      projectId,
      events: [
        team,
        event(2, "organization.team.kind.changed", {
          organizationId,
          teamId,
          projectId,
          repositoryIdentityHash: hash("1"),
          previousTeamKind: "project",
          teamKind: "central",
          revision: 2,
          changedAt: "2026-09-08T00:01:00.000Z",
        }),
      ],
    });
    expect(projection.team).toMatchObject({ organizationId, teamId, teamKind: "central" });
    expect(projection.teamKindRevision).toBe(2);
  });

  it("rejects stale team-kind history", () => {
    expect(() =>
      projectAgentOrganization({
        projectId,
        events: [
          team,
          event(2, "organization.team.kind.changed", {
            organizationId,
            teamId,
            projectId,
            repositoryIdentityHash: hash("1"),
            previousTeamKind: "central",
            teamKind: "project",
            revision: 2,
            changedAt: "2026-09-08T00:01:00.000Z",
          }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentOrganizationError>>({
        code: "organization_state_conflict",
      }),
    );
  });

  it("updates an agent's visible identity without changing its role or deployment", () => {
    const namedMembership = event(2, "organization.agent.membership.changed", {
      ...(membership.payload as Record<string, unknown>),
      agentDisplayName: "Nova",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
    });
    const namedDeployment = event(3, "organization.external_agent.deployment.bound", {
      ...(deployment.payload as Record<string, unknown>),
      agentDisplayName: "Nova",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
    });
    const projection = projectAgentOrganization({
      projectId,
      events: [
        team,
        namedMembership,
        namedDeployment,
        event(4, "organization.agent.identity.changed", {
          membershipId,
          organizationId,
          teamId,
          projectId,
          agentId,
          previousDisplayName: "Nova",
          displayName: "Sol",
          displayNameSource: "explicit",
          revision: 2,
          changedAt: "2026-09-08T00:03:00.000Z",
        }),
      ],
    });
    expect(projection.memberships[0]).toMatchObject({
      agentDisplayName: "Sol",
      displayNameRevision: 2,
      roleId: "developer",
    });
    expect(projection.deployments[0]).toMatchObject({
      agentDisplayName: "Sol",
      displayNameRevision: 2,
      deploymentId,
    });
  });

  it("rejects a second active bot principal and retirement before channel departure", () => {
    expect(() =>
      projectAgentOrganization({
        projectId,
        events: [
          team,
          membership,
          deployment,
          event(4, "organization.external_agent.deployment.bound", {
            ...(deployment.payload as Record<string, unknown>),
            deploymentId: "adep_conflict0001",
            participantId: "ptc_conflict0001",
          }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentOrganizationError>>({
        code: "organization_state_conflict",
      }),
    );

    expect(() =>
      projectAgentOrganization({
        projectId,
        events: [
          team,
          membership,
          deployment,
          channel,
          event(5, "organization.external_agent.deployment.retired", {
            deploymentId,
            organizationId,
            teamId,
            projectId,
            membershipId,
            agentId,
            reasonCode: "credential_rotated",
            retiredAt: "2026-09-08T00:07:00.000Z",
          }),
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentOrganizationError>>({
        code: "organization_state_conflict",
      }),
    );
  });
});
