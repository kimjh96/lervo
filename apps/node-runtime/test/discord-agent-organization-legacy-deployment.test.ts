import {
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
} from "@lervo/agent-organization";
import { openProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, expect, it, vi } from "vitest";

import type { NodeDiscordConversationConfig } from "../src/config-types.js";

// The first bind writes the hash a pre-ADR-0612 CLI wrote, so the second bind meets a legacy
// deployment exactly as an upgraded host does.
const mode = vi.hoisted(() => ({ legacy: true }));
vi.mock("@lervo/agent-organization", async (load) => {
  const real = await load<typeof import("@lervo/agent-organization")>();
  return {
    ...real,
    externalAgentDeploymentConfigHash: (
      input: Parameters<typeof real.externalAgentDeploymentConfigHash>[0],
    ) =>
      mode.legacy
        ? real.legacyExternalAgentDeploymentConfigHash({
            ...input,
            response: { provider: input.command.provider, model: null },
          })
        : real.externalAgentDeploymentConfigHash(input),
  };
});

const { appendOrganizationEvent, organizationPolicyHash } =
  await import("../src/agent-organization-event-mutation.js");
const { RepositoryDiscordAgentOrganizationDeployment } =
  await import("../src/discord-agent-organization-deployment.js");
const { availablePort, nodeRuntimeFixture, removeTemporaryRoots, temporaryRoot } =
  await import("./fixture.js");

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

it("keeps a deployment bound with the pre-ADR-0612 hash when the same configuration binds again", async () => {
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
  const config: NodeDiscordConversationConfig = {
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
  };
  const deployment = new RepositoryDiscordAgentOrganizationDeployment(fixture.repositoryRoot);
  await deployment.bind({ agent, config });
  mode.legacy = false;
  await deployment.bind({ agent, config });
  const verified = await openProjectStorage(fixture.repositoryRoot);
  try {
    const projection = projectAgentOrganizationFromEventSource({
      projectId: verified.manifest.projectId,
      events: verified.events,
    });
    expect(projection.deployments).toEqual([
      expect.objectContaining({ agentId: agent.agentId, retiredAt: null }),
    ]);
    expect(projection.channelMemberships).toEqual([
      expect.objectContaining({ conversationId: "cnv_project001", status: "active" }),
    ]);
  } finally {
    await verified.close();
  }
});
