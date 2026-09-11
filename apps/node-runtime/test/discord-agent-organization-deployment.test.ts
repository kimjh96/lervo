import {
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
} from "@lervo/agent-organization";
import { openProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendOrganizationEvent,
  organizationPolicyHash,
} from "../src/agent-organization-event-mutation.js";
import { RepositoryDiscordAgentOrganizationDeployment } from "../src/discord-agent-organization-deployment.js";
import {
  availablePort,
  nodeRuntimeFixture,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

const agent = {
  schemaVersion: 1 as const,
  agentId: "agt_0123456789abcdef01234567",
  projectId: "prj_node_runtime_01",
  displayName: "Navi",
  displayNameSource: "explicit" as const,
  roleId: "researcher",
  roleVersion: "1.0.0",
  roleContractHash: `sha256:${"a".repeat(64)}`,
  roleProfileHash: `sha256:${"b".repeat(64)}`,
  provider: "any" as const,
  capabilityHash: `sha256:${"c".repeat(64)}`,
  skillIds: [],
  capabilityPackages: [],
  responsibilityPaths: ["*"],
  parentAgentId: "agt_abcdef0123456789abcdef01",
  delegationDepth: 1,
  status: "active" as const,
  revision: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

describe("RepositoryDiscordAgentOrganizationDeployment", () => {
  it("binds membership, external deployment, and channel before runtime restart", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const storage = await openProjectStorage(fixture.repositoryRoot);
    try {
      appendOrganizationEvent(storage, "organization.team.bound", {
        organizationId: "org_lervoowner01",
        teamId: "team_project001",
        projectId: storage.manifest.projectId,
        repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
        organizationPolicyHash,
        teamPolicyHash: organizationIdentityHash({ projectId: storage.manifest.projectId }),
        teamKind: "project",
        boundAt: "2026-09-10T00:00:00.000Z",
      });
    } finally {
      await storage.close();
    }
    const deployment = new RepositoryDiscordAgentOrganizationDeployment(fixture.repositoryRoot);
    await deployment.bind({
      agent,
      config: {
        integrationId: "itg_discord_child01",
        applicationId: "999999999999999999",
        botTokenFile: "discord.token",
        intents: 37_377,
        allowedGuildIds: ["111111111111111111"],
        allowDirectMessages: false,
        workerId: "discord-child",
        agentParticipantId: "ptc_agent_child01",
        agentId: agent.agentId,
        speaker: {
          kind: "webhook",
          webhooks: [
            {
              channelId: "222222222222222222",
              webhookId: "444444444444444444",
              tokenFile: "webhook.token",
            },
          ],
        },
        organization: {
          organizationId: "org_lervoowner01",
          teamId: "team_project001",
        },
        conversations: [
          {
            tenantKey: "111111111111111111",
            conversationKey: "222222222222222222",
            conversationId: "cnv_project001",
          },
        ],
        participants: [],
        command: {
          roleId: "researcher",
          provider: "codex",
          risk: "low",
          verificationSuiteIds: ["repository.default.v4"],
          lifetimeMs: 300_000,
          assignmentId: null,
          agentId: agent.agentId,
        },
      },
    });
    const verified = await openProjectStorage(fixture.repositoryRoot);
    try {
      const projection = projectAgentOrganizationFromEventSource({
        projectId: verified.manifest.projectId,
        events: verified.events,
      });
      expect(projection.memberships).toEqual([
        expect.objectContaining({ agentId: agent.agentId, status: "active" }),
      ]);
      expect(projection.deployments).toEqual([
        expect.objectContaining({ agentId: agent.agentId, retiredAt: null }),
      ]);
      expect(projection.channelMemberships).toEqual([
        expect.objectContaining({
          agentId: agent.agentId,
          conversationId: "cnv_project001",
          status: "active",
        }),
      ]);
    } finally {
      await verified.close();
    }
    await deployment.deactivate({
      agent: {
        ...agent,
        status: "retired",
        revision: 2,
        updatedAt: "2026-09-11T00:00:00.000Z",
      },
    });
    const retired = await openProjectStorage(fixture.repositoryRoot);
    try {
      const projection = projectAgentOrganizationFromEventSource({
        projectId: retired.manifest.projectId,
        events: retired.events,
      });
      expect(projection.memberships).toEqual([
        expect.objectContaining({ agentId: agent.agentId, status: "ended", revision: 2 }),
      ]);
      expect(projection.deployments).toEqual([
        expect.objectContaining({ agentId: agent.agentId, retirementReasonCode: "agent_retired" }),
      ]);
      expect(projection.channelMemberships).toEqual([
        expect.objectContaining({ agentId: agent.agentId, status: "ended", revision: 2 }),
      ]);
    } finally {
      await retired.close();
    }
  });
});
