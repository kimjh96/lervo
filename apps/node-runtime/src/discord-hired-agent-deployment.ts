import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DiscordAdministrationPort } from "@lervo/adapter-discord";
import type { WorkforceAgent } from "@lervo/agent-workforce";

import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import { parseNodeRuntimeConfig } from "./config.js";
import type { DiscordAgentOrganizationDeploymentPort } from "./discord-agent-organization-deployment.js";

interface PreparedWebhook {
  schemaVersion: 1;
  agentId: string;
  conversationId: string;
  guildId: string;
  channelId: string;
  webhookId: string;
  tokenFile: string;
  displayName?: string;
}

export interface ConversationWorkforceDeploymentPort {
  prepare(input: {
    agent: WorkforceAgent;
    conversationId: string;
  }): Promise<{ participantId: string; webhookId: string; configurationChanged: boolean }>;
}

function childParticipantId(agentId: string): string {
  return `ptc_agent_${agentId.slice("agt_".length)}`;
}

function childIntegrationId(agentId: string): string {
  return `itg_discord_${agentId.slice("agt_".length)}`;
}

function ownerPath(directory: string, agentId: string, suffix: string): string {
  return resolve(directory, `${agentId}.${suffix}`);
}

async function ensureOwnerDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The Discord webhook credential location is not a physical directory.");
  }
  await chmod(path, 0o700);
}

async function readPreparedWebhook(path: string): Promise<PreparedWebhook | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("The prepared Discord webhook record is not a physical file.");
    }
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.agentId !== "string" ||
      typeof value.conversationId !== "string" ||
      typeof value.guildId !== "string" ||
      typeof value.channelId !== "string" ||
      typeof value.webhookId !== "string" ||
      typeof value.tokenFile !== "string" ||
      (value.displayName !== undefined && typeof value.displayName !== "string")
    ) {
      throw new Error("The prepared Discord webhook record is invalid.");
    }
    return value as unknown as PreparedWebhook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writePreparedWebhook(path: string, value: PreparedWebhook): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function childDeployment(input: {
  parent: NodeDiscordConversationConfig;
  agent: WorkforceAgent;
  conversationId: string;
  webhook: PreparedWebhook;
}): NodeDiscordConversationConfig {
  const conversation = input.parent.conversations.find(
    (candidate) => candidate.conversationId === input.conversationId,
  );
  if (conversation === undefined) {
    throw new Error("The hired agent conversation is outside the parent deployment.");
  }
  const provider =
    input.agent.provider === "any"
      ? (input.parent.routing?.response.provider ?? input.parent.command.provider)
      : input.agent.provider;
  return {
    integrationId: childIntegrationId(input.agent.agentId),
    applicationId: input.parent.applicationId,
    botTokenFile: input.parent.botTokenFile,
    intents: input.parent.intents,
    allowedGuildIds: [conversation.tenantKey],
    allowDirectMessages: false,
    workerId: `discord-${input.agent.agentId.slice("agt_".length)}`,
    agentParticipantId: childParticipantId(input.agent.agentId),
    agentId: input.agent.agentId,
    speaker: {
      kind: "webhook",
      webhooks: [
        {
          channelId: conversation.conversationKey,
          webhookId: input.webhook.webhookId,
          tokenFile: input.webhook.tokenFile,
        },
      ],
    },
    ...(input.parent.organization === undefined ? {} : { organization: input.parent.organization }),
    conversations: [conversation],
    participants: input.parent.participants.filter(
      (participant) => participant.actorKind === "human",
    ),
    ...(input.parent.routing === undefined
      ? {}
      : {
          routing: {
            ...input.parent.routing,
            response: { ...input.parent.routing.response, provider },
          },
        }),
    command: {
      ...input.parent.command,
      roleId: input.agent.roleId,
      provider,
      assignmentId: null,
      agentId: input.agent.agentId,
    },
    ...(input.parent.gateway === undefined ? {} : { gateway: input.parent.gateway }),
    ...(input.parent.http === undefined ? {} : { http: input.parent.http }),
    policy: {
      ...input.parent.policy,
      respondTo: ["human", "agent", "system"],
      unaddressedHumanMessages: "evaluate",
      mode: "relevant",
    },
  };
}

export class DiscordHiredAgentDeployment implements ConversationWorkforceDeploymentPort {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      configPath: string;
      parentIntegrationId: string;
      administration: Pick<
        DiscordAdministrationPort,
        "createIncomingWebhook" | "updateIncomingWebhook"
      > &
        Partial<Pick<DiscordAdministrationPort, "deleteIncomingWebhook">>;
      organization?: DiscordAgentOrganizationDeploymentPort;
    },
  ) {}

  prepare(input: Parameters<ConversationWorkforceDeploymentPort["prepare"]>[0]) {
    const next = this.operation.then(() => this.prepareExclusive(input));
    this.operation = next.catch(() => undefined);
    return next;
  }

  deactivate(input: { agent: WorkforceAgent }) {
    const next = this.operation.then(() => this.deactivateExclusive(input));
    this.operation = next.catch(() => undefined);
    return next;
  }

  private async deactivateExclusive(input: {
    agent: WorkforceAgent;
  }): Promise<{ configurationChanged: boolean; webhookId: string | null }> {
    if (input.agent.status !== "retired") {
      throw new Error("Only a retired hired agent can be removed from Discord deployment.");
    }
    const configMetadata = await lstat(this.options.configPath);
    if (!configMetadata.isFile() || configMetadata.isSymbolicLink()) {
      throw new Error("The Node runtime configuration is not a physical file.");
    }
    const config = parseNodeRuntimeConfig(
      JSON.parse(await readFile(this.options.configPath, "utf8")),
      dirname(this.options.configPath),
    );
    const deployments =
      config.discordConversations ??
      (config.discordConversation === undefined ? [] : [config.discordConversation]);
    const existing = deployments.find((candidate) => candidate.agentId === input.agent.agentId);
    if (existing === undefined) {
      const parent = deployments.find(
        (candidate) => candidate.integrationId === this.options.parentIntegrationId,
      );
      const directory = parent?.administration?.webhookCredentialDirectory;
      const recorded =
        directory === undefined
          ? null
          : await readPreparedWebhook(ownerPath(directory, input.agent.agentId, "deployment.json"));
      if (recorded !== null) {
        if (this.options.administration.deleteIncomingWebhook === undefined) {
          throw new Error("Automatic hired-agent Discord retirement is not configured.");
        }
        await this.options.administration.deleteIncomingWebhook({
          guildId: recorded.guildId,
          channelId: recorded.channelId,
          webhookId: recorded.webhookId,
        });
      }
      await this.options.organization?.deactivate?.({ agent: input.agent });
      if (directory !== undefined) {
        await Promise.all([
          rm(ownerPath(directory, input.agent.agentId, "token"), { force: true }),
          rm(ownerPath(directory, input.agent.agentId, "deployment.json"), { force: true }),
          rm(ownerPath(directory, input.agent.agentId, "pending.json"), { force: true }),
        ]);
      }
      return { configurationChanged: false, webhookId: recorded?.webhookId ?? null };
    }
    if (existing.integrationId === this.options.parentIntegrationId) {
      throw new Error("The product-owner Discord deployment cannot retire itself.");
    }
    if (existing.speaker?.kind !== "webhook" || existing.speaker.webhooks.length !== 1) {
      throw new Error("The hired-agent Discord deployment is not a managed webhook speaker.");
    }
    const webhook = existing.speaker.webhooks[0]!;
    const conversation = existing.conversations.find(
      (candidate) => candidate.conversationKey === webhook.channelId,
    );
    if (conversation === undefined || conversation.tenantKey === "dm") {
      throw new Error("The hired-agent Discord webhook is outside its configured conversation.");
    }
    if (this.options.administration.deleteIncomingWebhook === undefined) {
      throw new Error("Automatic hired-agent Discord retirement is not configured.");
    }
    await this.options.administration.deleteIncomingWebhook({
      guildId: conversation.tenantKey,
      channelId: conversation.conversationKey,
      webhookId: webhook.webhookId,
    });
    await this.options.organization?.deactivate?.({ agent: input.agent });
    const nextConfig: NodeRuntimeConfig = {
      ...config,
      discordConversations: deployments.filter(
        (candidate) => candidate.agentId !== input.agent.agentId,
      ),
    };
    delete nextConfig.discordConversation;
    parseNodeRuntimeConfig(nextConfig, dirname(this.options.configPath));
    const temporary = `${this.options.configPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(nextConfig, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: configMetadata.mode & 0o777,
    });
    await rename(temporary, this.options.configPath);
    await chmod(this.options.configPath, configMetadata.mode & 0o777);
    const directory = dirname(webhook.tokenFile);
    await Promise.all([
      rm(webhook.tokenFile, { force: true }),
      rm(ownerPath(directory, input.agent.agentId, "deployment.json"), { force: true }),
      rm(ownerPath(directory, input.agent.agentId, "pending.json"), { force: true }),
    ]);
    return { configurationChanged: true, webhookId: webhook.webhookId };
  }

  private async prepareExclusive(input: {
    agent: WorkforceAgent;
    conversationId: string;
  }): Promise<{ participantId: string; webhookId: string; configurationChanged: boolean }> {
    const configMetadata = await lstat(this.options.configPath);
    if (!configMetadata.isFile() || configMetadata.isSymbolicLink()) {
      throw new Error("The Node runtime configuration is not a physical file.");
    }
    const config = parseNodeRuntimeConfig(
      JSON.parse(await readFile(this.options.configPath, "utf8")),
      dirname(this.options.configPath),
    );
    const deployments =
      config.discordConversations ??
      (config.discordConversation === undefined ? [] : [config.discordConversation]);
    const parent = deployments.find(
      (candidate) => candidate.integrationId === this.options.parentIntegrationId,
    );
    if (
      parent === undefined ||
      parent.administration?.allowedActions.includes("incoming_webhook.create") !== true ||
      parent.administration.webhookCredentialDirectory === undefined
    ) {
      throw new Error("Automatic hired-agent Discord deployment is not configured.");
    }
    const conversation = parent.conversations.find(
      (candidate) => candidate.conversationId === input.conversationId,
    );
    if (conversation === undefined || conversation.tenantKey === "dm") {
      throw new Error("The hired agent requires an allowlisted guild conversation.");
    }
    const directory = parent.administration.webhookCredentialDirectory;
    await ensureOwnerDirectory(directory);
    const recordPath = ownerPath(directory, input.agent.agentId, "deployment.json");
    const tokenFile = ownerPath(directory, input.agent.agentId, "token");
    const pendingPath = ownerPath(directory, input.agent.agentId, "pending.json");
    const existing = deployments.find((candidate) => candidate.agentId === input.agent.agentId);
    if (existing?.speaker?.kind === "webhook") {
      const configuredWebhook = existing.speaker.webhooks.find(
        (candidate) => candidate.channelId === conversation.conversationKey,
      );
      if (configuredWebhook === undefined || configuredWebhook.tokenFile !== tokenFile) {
        throw new Error(
          "The existing hired-agent Discord deployment differs from its owner record.",
        );
      }
      let recorded = await readPreparedWebhook(recordPath);
      if (
        recorded !== null &&
        (recorded.agentId !== input.agent.agentId ||
          recorded.conversationId !== input.conversationId ||
          recorded.guildId !== conversation.tenantKey ||
          recorded.channelId !== conversation.conversationKey ||
          recorded.webhookId !== configuredWebhook.webhookId ||
          recorded.tokenFile !== tokenFile)
      ) {
        throw new Error("The prepared Discord webhook differs from the existing deployment.");
      }
      if (recorded?.displayName !== input.agent.displayName) {
        await this.options.administration.updateIncomingWebhook({
          guildId: conversation.tenantKey,
          channelId: conversation.conversationKey,
          webhookId: configuredWebhook.webhookId,
          name: input.agent.displayName,
        });
        recorded = {
          schemaVersion: 1,
          agentId: input.agent.agentId,
          conversationId: input.conversationId,
          guildId: conversation.tenantKey,
          channelId: conversation.conversationKey,
          webhookId: configuredWebhook.webhookId,
          tokenFile,
          displayName: input.agent.displayName,
        };
        await writePreparedWebhook(recordPath, recorded);
      }
      await this.options.organization?.bind({ config: existing, agent: input.agent });
      return {
        participantId: existing.agentParticipantId,
        webhookId: configuredWebhook.webhookId,
        configurationChanged: false,
      };
    }
    let webhook = await readPreparedWebhook(recordPath);
    if (webhook === null) {
      try {
        await writeFile(
          pendingPath,
          `${JSON.stringify({ schemaVersion: 1, agentId: input.agent.agentId, conversationId: input.conversationId })}\n`,
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(
            "A prior Discord webhook preparation has an uncertain result and requires reconciliation.",
            { cause: error },
          );
        }
        throw error;
      }
      const created = await this.options.administration.createIncomingWebhook({
        guildId: conversation.tenantKey,
        channelId: conversation.conversationKey,
        name: input.agent.displayName,
      });
      await writeFile(tokenFile, `${created.token}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      webhook = {
        schemaVersion: 1,
        agentId: input.agent.agentId,
        conversationId: input.conversationId,
        guildId: created.guildId,
        channelId: created.channelId,
        webhookId: created.webhookId,
        tokenFile,
        displayName: input.agent.displayName,
      };
      await writePreparedWebhook(recordPath, webhook);
    }
    if (
      webhook.agentId !== input.agent.agentId ||
      webhook.conversationId !== input.conversationId ||
      webhook.guildId !== conversation.tenantKey ||
      webhook.channelId !== conversation.conversationKey ||
      webhook.tokenFile !== tokenFile
    ) {
      throw new Error("The prepared Discord webhook differs from the requested deployment.");
    }
    const nextConfig: NodeRuntimeConfig = {
      ...config,
      discordConversations: [
        ...deployments,
        childDeployment({
          parent,
          agent: input.agent,
          conversationId: input.conversationId,
          webhook,
        }),
      ],
    };
    delete nextConfig.discordConversation;
    parseNodeRuntimeConfig(nextConfig, dirname(this.options.configPath));
    const prepared = nextConfig.discordConversations!.at(-1)!;
    await this.options.organization?.bind({ config: prepared, agent: input.agent });
    const temporary = `${this.options.configPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(nextConfig, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: configMetadata.mode & 0o777,
    });
    await rename(temporary, this.options.configPath);
    await chmod(this.options.configPath, configMetadata.mode & 0o777);
    await rm(pendingPath, { force: true });
    return {
      participantId: childParticipantId(input.agent.agentId),
      webhookId: webhook.webhookId,
      configurationChanged: true,
    };
  }
}
