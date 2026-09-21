import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DiscordAdministrationPort } from "@lervo/adapter-discord";
import type { WorkforceAgent } from "@lervo/agent-workforce";

import type { NodeRuntimeConfig } from "./config-types.js";
import { parseNodeRuntimeConfig } from "./config.js";
import type { DiscordAgentOrganizationDeploymentPort } from "./discord-agent-organization-deployment.js";
import {
  createHiredAgentConversationDeployment,
  ensureDiscordOwnerDirectory,
  hiredAgentOwnerPath,
  hiredAgentParticipantId,
  readPreparedDiscordWebhook,
  writePreparedDiscordWebhook,
} from "./discord-hired-agent-configuration.js";

export interface ConversationWorkforceDeploymentPort {
  prepare(input: {
    agent: WorkforceAgent;
    conversationId: string;
  }): Promise<{ participantId: string; webhookId: string | null; configurationChanged: boolean }>;
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
          : await readPreparedDiscordWebhook(
              hiredAgentOwnerPath(directory, input.agent.agentId, "deployment.json"),
            );
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
          rm(hiredAgentOwnerPath(directory, input.agent.agentId, "token"), { force: true }),
          rm(hiredAgentOwnerPath(directory, input.agent.agentId, "deployment.json"), {
            force: true,
          }),
          rm(hiredAgentOwnerPath(directory, input.agent.agentId, "pending.json"), {
            force: true,
          }),
        ]);
      }
      return { configurationChanged: false, webhookId: recorded?.webhookId ?? null };
    }
    if (existing.integrationId === this.options.parentIntegrationId) {
      throw new Error("The parent Discord deployment cannot retire itself.");
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
      rm(hiredAgentOwnerPath(directory, input.agent.agentId, "deployment.json"), {
        force: true,
      }),
      rm(hiredAgentOwnerPath(directory, input.agent.agentId, "pending.json"), { force: true }),
    ]);
    return { configurationChanged: true, webhookId: webhook.webhookId };
  }

  private async prepareExclusive(input: {
    agent: WorkforceAgent;
    conversationId: string;
  }): Promise<{ participantId: string; webhookId: string | null; configurationChanged: boolean }> {
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
    await ensureDiscordOwnerDirectory(directory);
    const recordPath = hiredAgentOwnerPath(directory, input.agent.agentId, "deployment.json");
    const tokenFile = hiredAgentOwnerPath(directory, input.agent.agentId, "token");
    const pendingPath = hiredAgentOwnerPath(directory, input.agent.agentId, "pending.json");
    const existing = deployments.find((candidate) => candidate.agentId === input.agent.agentId);
    if (existing !== undefined && existing.speaker?.kind !== "webhook") {
      if (
        !existing.conversations.some(
          (candidate) => candidate.conversationId === input.conversationId,
        )
      ) {
        throw new Error(
          "The existing hired-agent Discord application is outside the requested conversation.",
        );
      }
      await this.options.organization?.bind({ config: existing, agent: input.agent });
      return {
        participantId: existing.agentParticipantId,
        webhookId: null,
        configurationChanged: false,
      };
    }
    if (existing?.speaker?.kind === "webhook") {
      const configuredWebhook = existing.speaker.webhooks.find(
        (candidate) => candidate.channelId === conversation.conversationKey,
      );
      if (configuredWebhook === undefined || configuredWebhook.tokenFile !== tokenFile) {
        throw new Error(
          "The existing hired-agent Discord deployment differs from its owner record.",
        );
      }
      let recorded = await readPreparedDiscordWebhook(recordPath);
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
        await writePreparedDiscordWebhook(recordPath, recorded);
      }
      await this.options.organization?.bind({ config: existing, agent: input.agent });
      return {
        participantId: existing.agentParticipantId,
        webhookId: configuredWebhook.webhookId,
        configurationChanged: false,
      };
    }
    let webhook = await readPreparedDiscordWebhook(recordPath);
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
      await writePreparedDiscordWebhook(recordPath, webhook);
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
        createHiredAgentConversationDeployment({
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
      participantId: hiredAgentParticipantId(input.agent.agentId),
      webhookId: webhook.webhookId,
      configurationChanged: true,
    };
  }
}
