import { resolve } from "node:path";

import {
  DiscordConversationAdapter,
  DiscordRestDelivery,
} from "@lervo/adapter-discord";
import {
  SlackConversationAdapter,
  SlackWebApiDelivery,
} from "@lervo/adapter-slack";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteConversationPlatformStore } from "@lervo/conversation-platform-sqlite";

import type { ConversationApplication, ConversationApplicationOptions } from "./types.js";

function uniqueIntegrations(options: ConversationApplicationOptions): void {
  const deployments = [
    ...(options.slack ?? []).map((item) => ({ id: item.integrationId, platform: "slack" as const })),
    ...(options.discord ?? []).map((item) => ({ id: item.integrationId, platform: "discord" as const })),
  ];
  const identifiers = deployments.map((item) => item.id);
  if (identifiers.length === 0 || new Set(identifiers).size !== identifiers.length) {
    throw new Error("Conversation deployment에는 서로 다른 integration이 하나 이상 필요합니다.");
  }
  const configured = new Map(deployments.map((item) => [item.id, item.platform]));
  if ([...options.conversations, ...options.participants, ...(options.threads ?? [])]
    .some((binding) => configured.get(binding.integrationId) !== binding.platform)) {
    throw new Error("Conversation binding이 배포되지 않은 integration을 가리킵니다.");
  }
  for (const deployment of deployments) {
    if (!options.conversations.some((binding) => binding.integrationId === deployment.id) ||
      !options.participants.some((binding) => binding.integrationId === deployment.id)) {
      throw new Error("배포된 conversation integration에는 주소와 participant binding이 필요합니다.");
    }
  }
}

export async function openConversationApplication(
  options: ConversationApplicationOptions,
): Promise<ConversationApplication> {
  uniqueIntegrations(options);
  const artifactStore = await FileSystemCas.open(resolve(options.dataDirectory, "artifacts"));
  const store = await SQLiteConversationPlatformStore.open({
    path: resolve(options.dataDirectory, "platform.sqlite"),
    conversations: options.conversations,
    participants: options.participants,
    ...(options.threads === undefined ? {} : { threads: options.threads }),
  });
  try {
    const slackAdapters = new Map((options.slack ?? []).map((deployment) => {
      const delivery = new SlackWebApiDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(deployment.requestTimeoutMs === undefined ? {} : {
          requestTimeoutMs: deployment.requestTimeoutMs,
        }),
        ...(deployment.maxResponseBytes === undefined ? {} : {
          maxResponseBytes: deployment.maxResponseBytes,
        }),
      });
      return [deployment.integrationId, new SlackConversationAdapter({
        integrationId: deployment.integrationId,
        apiAppId: deployment.apiAppId,
        allowedTeamIds: deployment.allowedTeamIds,
        signingSecret: deployment.signingSecret,
        identity: store,
        artifactStore,
        delivery,
        ...(options.now === undefined ? {} : { now: options.now }),
      })] as const;
    }));
    const discordAdapters = new Map((options.discord ?? []).map((deployment) => {
      const delivery = new DiscordRestDelivery({
        integrationId: deployment.integrationId,
        botToken: deployment.botToken,
        replay: store,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        ...(deployment.requestTimeoutMs === undefined ? {} : {
          requestTimeoutMs: deployment.requestTimeoutMs,
        }),
        ...(deployment.maxResponseBytes === undefined ? {} : {
          maxResponseBytes: deployment.maxResponseBytes,
        }),
      });
      return [deployment.integrationId, new DiscordConversationAdapter({
        integrationId: deployment.integrationId,
        applicationId: deployment.applicationId,
        allowedGuildIds: deployment.allowedGuildIds,
        allowDirectMessages: deployment.allowDirectMessages,
        gatewayAuthentication: deployment.gatewayAuthentication,
        identity: store,
        artifactStore,
        delivery,
        ...(options.now === undefined ? {} : { now: options.now }),
      })] as const;
    }));
    return {
      slackAdapters,
      discordAdapters,
      close: () => store.close(),
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
