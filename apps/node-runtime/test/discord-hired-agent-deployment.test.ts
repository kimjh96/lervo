import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadNodeRuntimeConfig } from "../src/config.js";
import { DiscordHiredAgentDeployment } from "../src/discord-hired-agent-deployment.js";
import {
  availablePort,
  nodeRuntimeFixture,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

function agent() {
  return {
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
}

describe("DiscordHiredAgentDeployment", () => {
  it("prepares one owner-only webhook and atomically adds a distinct child deployment", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const credentialDirectory = resolve(root, "discord-webhooks");
    const configured = structuredClone(fixture.value);
    configured.discordConversation = {
      integrationId: "itg_discord_parent01",
      applicationId: "999999999999999999",
      botTokenFile: resolve(root, "discord.token"),
      intents: 37_377,
      allowedGuildIds: ["123456789012345678"],
      allowDirectMessages: false,
      workerId: "discord-parent",
      agentParticipantId: "ptc_parent0001",
      agentId: "agt_abcdef0123456789abcdef01",
      speaker: { kind: "bot" },
      organization: { organizationId: "org_lervoowner01", teamId: "team_project001" },
      conversations: [
        {
          tenantKey: "123456789012345678",
          conversationKey: "223456789012345678",
          conversationId: "cnv_project001",
        },
      ],
      participants: [
        {
          tenantKey: "123456789012345678",
          userId: "323456789012345678",
          participantId: "ptc_owner0001",
          actorKind: "human",
          roleId: null,
        },
      ],
      administration: {
        allowedActions: ["incoming_webhook.create", "workforce.agent.hire"],
        webhookCredentialDirectory: credentialDirectory,
      },
      routing: {
        readOnlyRoleId: "conversation-reader",
        response: {
          provider: "codex",
          model: "gpt-6-astra",
          reasoningEffort: "low",
        },
      },
      command: {
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repository.default.v4"],
        lifetimeMs: 300_000,
        assignmentId: null,
        agentId: null,
      },
    };
    await writeFile(fixture.configPath, `${JSON.stringify(configured, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(fixture.configPath, 0o600);
    const createIncomingWebhook = vi.fn(async () => ({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "423456789012345678",
      name: "Navi",
      token: "webhook-token-aaaaaaaaaaaaaaaaaaaaaaaa",
      observedAt: "2026-09-10T00:00:01.000Z",
    }));
    const updateIncomingWebhook = vi.fn(
      async (input: { guildId: string; channelId: string; webhookId: string; name: string }) => ({
        ...input,
        observedAt: "2026-09-11T00:00:01.000Z",
      }),
    );
    const deleteIncomingWebhook = vi.fn(
      async (input: { guildId: string; channelId: string; webhookId: string }) => ({
        ...input,
        observedAt: "2026-09-11T00:00:02.000Z",
      }),
    );
    const bindOrganization = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("organization unavailable"))
      .mockResolvedValue(undefined);
    const deployment = new DiscordHiredAgentDeployment({
      configPath: fixture.configPath,
      parentIntegrationId: "itg_discord_parent01",
      administration: { createIncomingWebhook, updateIncomingWebhook, deleteIncomingWebhook },
      organization: { bind: bindOrganization },
    });

    await expect(
      deployment.prepare({ agent: agent(), conversationId: "cnv_project001" }),
    ).rejects.toThrow("organization unavailable");
    const configurationAfterBindingFailure = await loadNodeRuntimeConfig(fixture.configPath);
    expect(configurationAfterBindingFailure.discordConversation).toMatchObject({
      integrationId: "itg_discord_parent01",
    });
    expect(configurationAfterBindingFailure.discordConversations).toBeUndefined();
    await expect(
      deployment.prepare({ agent: agent(), conversationId: "cnv_project001" }),
    ).resolves.toEqual({
      participantId: "ptc_agent_0123456789abcdef01234567",
      webhookId: "423456789012345678",
      configurationChanged: true,
    });
    const parsed = await loadNodeRuntimeConfig(fixture.configPath);
    expect(parsed.discordConversation).toBeUndefined();
    expect(parsed.discordConversations).toHaveLength(2);
    expect(parsed.discordConversations?.[1]).toMatchObject({
      integrationId: "itg_discord_0123456789abcdef01234567",
      agentParticipantId: "ptc_agent_0123456789abcdef01234567",
      agentId: agent().agentId,
      speaker: {
        kind: "webhook",
        webhooks: [
          {
            channelId: "223456789012345678",
            webhookId: "423456789012345678",
          },
        ],
      },
      command: { roleId: "researcher", provider: "codex", agentId: agent().agentId },
    });
    const tokenFile = resolve(credentialDirectory, `${agent().agentId}.token`);
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect((await readFile(tokenFile, "utf8")).trim()).toBe(
      "webhook-token-aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    await expect(
      deployment.prepare({ agent: agent(), conversationId: "cnv_project001" }),
    ).resolves.toMatchObject({ configurationChanged: false });
    expect(createIncomingWebhook).toHaveBeenCalledTimes(1);
    expect(updateIncomingWebhook).not.toHaveBeenCalled();

    await expect(
      deployment.prepare({
        agent: { ...agent(), displayName: "Sora", revision: 2 },
        conversationId: "cnv_project001",
      }),
    ).resolves.toMatchObject({ configurationChanged: false });
    expect(createIncomingWebhook).toHaveBeenCalledTimes(1);
    expect(updateIncomingWebhook).toHaveBeenCalledOnce();
    expect(updateIncomingWebhook).toHaveBeenCalledWith({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "423456789012345678",
      name: "Sora",
    });
    expect(bindOrganization).toHaveBeenCalledTimes(4);
    expect(bindOrganization).toHaveBeenLastCalledWith({
      config: expect.objectContaining({ agentId: agent().agentId }),
      agent: expect.objectContaining({ displayName: "Sora" }),
    });

    await expect(
      deployment.deactivate({
        agent: { ...agent(), displayName: "Sora", status: "retired", revision: 3 },
      }),
    ).resolves.toEqual({
      configurationChanged: true,
      webhookId: "423456789012345678",
    });
    expect(deleteIncomingWebhook).toHaveBeenCalledWith({
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      webhookId: "423456789012345678",
    });
    const retiredConfig = await loadNodeRuntimeConfig(fixture.configPath);
    expect(retiredConfig.discordConversations).toHaveLength(1);
    expect(retiredConfig.discordConversations?.[0]?.integrationId).toBe("itg_discord_parent01");
    await expect(stat(tokenFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      deployment.deactivate({
        agent: { ...agent(), displayName: "Sora", status: "retired", revision: 3 },
      }),
    ).resolves.toEqual({ configurationChanged: false, webhookId: null });

    const appTokenFile = resolve(root, "navi-discord.token");
    await writeFile(appTokenFile, "navi-application-token\n", { mode: 0o600 });
    const parent = retiredConfig.discordConversations![0]!;
    await writeFile(
      fixture.configPath,
      `${JSON.stringify(
        {
          ...retiredConfig,
          discordConversations: [
            parent,
            {
              ...parent,
              integrationId: "itg_discord_navi01",
              applicationId: "999999999999999998",
              botTokenFile: appTokenFile,
              workerId: "discord-navi",
              agentParticipantId: "ptc_agent_0123456789abcdef01234567",
              agentId: agent().agentId,
              speaker: { kind: "bot" },
              administration: undefined,
              command: {
                ...parent.command,
                roleId: agent().roleId,
                agentId: agent().agentId,
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await expect(
      deployment.prepare({ agent: agent(), conversationId: "cnv_project001" }),
    ).resolves.toEqual({
      participantId: "ptc_agent_0123456789abcdef01234567",
      webhookId: null,
      configurationChanged: false,
    });
    expect(createIncomingWebhook).toHaveBeenCalledTimes(1);
  });
});
