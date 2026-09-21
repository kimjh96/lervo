import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { WorkforceAgent } from "@lervo/agent-workforce";

import type { NodeDiscordConversationConfig } from "./config-types.js";

export interface PreparedDiscordWebhook {
  schemaVersion: 1;
  agentId: string;
  conversationId: string;
  guildId: string;
  channelId: string;
  webhookId: string;
  tokenFile: string;
  displayName?: string;
}

export function hiredAgentParticipantId(agentId: string): string {
  return `ptc_agent_${agentId.slice("agt_".length)}`;
}

function hiredAgentIntegrationId(agentId: string): string {
  return `itg_discord_${agentId.slice("agt_".length)}`;
}

export function hiredAgentOwnerPath(directory: string, agentId: string, suffix: string): string {
  return resolve(directory, `${agentId}.${suffix}`);
}

export async function ensureDiscordOwnerDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The Discord webhook credential location is not a physical directory.");
  }
  await chmod(path, 0o700);
}

export async function readPreparedDiscordWebhook(
  path: string,
): Promise<PreparedDiscordWebhook | null> {
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
    return value as unknown as PreparedDiscordWebhook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writePreparedDiscordWebhook(
  path: string,
  value: PreparedDiscordWebhook,
): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export function createHiredAgentConversationDeployment(input: {
  parent: NodeDiscordConversationConfig;
  agent: WorkforceAgent;
  conversationId: string;
  webhook: PreparedDiscordWebhook;
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
    integrationId: hiredAgentIntegrationId(input.agent.agentId),
    applicationId: input.parent.applicationId,
    botTokenFile: input.parent.botTokenFile,
    intents: input.parent.intents,
    allowedGuildIds: [conversation.tenantKey],
    allowDirectMessages: false,
    workerId: `discord-${input.agent.agentId.slice("agt_".length)}`,
    agentParticipantId: hiredAgentParticipantId(input.agent.agentId),
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
      unaddressedPriority: 0,
      acceptsSupervisionGoals: false,
      acceptsPeerWork: true,
    },
  };
}
