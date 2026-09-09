import { resolve } from "node:path";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  parseDiscordConversationBindings,
  parseDiscordParticipantBindings,
} from "./discord-conversation-bindings-config.js";
import { parseDiscordConversationBehavior } from "./discord-conversation-behavior-config.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";
import { parseDiscordAgentOrganization } from "./discord-agent-organization-config.js";
import { parseDiscordConversationDeliberation } from "./discord-conversation-deliberation-config.js";
import { parseDiscordConversationSpeaker } from "./discord-conversation-speaker-config.js";
import { discordSpeakerParticipantKeys } from "./discord-conversation-speaker.js";
import { parseDiscordPeerAgents } from "./discord-peer-agents-config.js";
import { parseDiscordRepositorySignals } from "./discord-repository-signals-config.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const INTEGRATION_ID = /^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SNOWFLAKE = /^[0-9]{1,32}$/u;
const PARTICIPANT_ID = /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

function boundedUniqueText(
  value: unknown,
  label: string,
  pattern: RegExp,
  minimum = 1,
  maximum = 64,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !pattern.test(item)) ||
    new Set(value).size !== value.length
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return [...value] as string[];
}

export function parseDiscordConversationConfig(
  value: unknown,
  baseDirectory: string,
): NodeDiscordConversationConfig {
  const source = configRecord(value, "discordConversation");
  exactConfigKeys(
    source,
    [
      "integrationId",
      "applicationId",
      "botTokenFile",
      "intents",
      "allowedGuildIds",
      "allowDirectMessages",
      "workerId",
      "agentParticipantId",
      "agentId",
      "speaker",
      "organization",
      "conversations",
      "participants",
      "peerAgents",
      "administration",
      "routing",
      "command",
      "gateway",
      "http",
      "policy",
      "repositorySignals",
      "deliberation",
    ],
    "discordConversation",
  );
  const integrationId = configText(source.integrationId, "discordConversation.integrationId");
  const applicationId = configText(source.applicationId, "discordConversation.applicationId");
  const workerId = configText(source.workerId, "discordConversation.workerId");
  const agentParticipantId = configText(
    source.agentParticipantId,
    "discordConversation.agentParticipantId",
  );
  const agentId =
    source.agentId === undefined
      ? undefined
      : configText(source.agentId, "discordConversation.agentId");
  const organization = parseDiscordAgentOrganization(source.organization);
  if (
    !INTEGRATION_ID.test(integrationId) ||
    !SNOWFLAKE.test(applicationId) ||
    !IDENTIFIER.test(workerId) ||
    !PARTICIPANT_ID.test(agentParticipantId) ||
    (agentId !== undefined && !/^agt_[a-f0-9]{24}$/u.test(agentId)) ||
    !Number.isSafeInteger(source.intents) ||
    (source.intents as number) < 1 ||
    (source.intents as number) > 2 ** 31 - 1 ||
    typeof source.allowDirectMessages !== "boolean"
  ) {
    throw new NodeRuntimeError("invalid_config", "The Discord conversation identity is invalid.");
  }
  const allowedGuildIds = boundedUniqueText(
    source.allowedGuildIds,
    "discordConversation.allowedGuildIds",
    SNOWFLAKE,
    source.allowDirectMessages ? 0 : 1,
  );
  const conversations = parseDiscordConversationBindings(source.conversations);
  const participants = parseDiscordParticipantBindings(source.participants);
  const speaker = parseDiscordConversationSpeaker(
    source.speaker,
    baseDirectory,
    conversations.map((conversation) => conversation.conversationKey),
  );
  const peerAgents = parseDiscordPeerAgents(source.peerAgents, {
    allowedTenantKeys: [...allowedGuildIds, ...(source.allowDirectMessages ? ["dm"] : [])],
    conversations,
    ownParticipantId: agentParticipantId,
    ...(agentId === undefined ? {} : { ownAgentId: agentId }),
    ownParticipantKeys: discordSpeakerParticipantKeys({
      applicationId,
      ...(speaker === undefined ? {} : { speaker }),
    }),
    manualParticipants: participants,
  });
  if (
    speaker?.kind === "webhook" &&
    (agentId === undefined || conversations.some((conversation) => conversation.tenantKey === "dm"))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "A Discord webhook speaker requires one active hired agent and guild-only conversations.",
    );
  }
  const administration =
    source.administration === undefined
      ? undefined
      : configRecord(source.administration, "discordConversation.administration");
  if (administration !== undefined) {
    exactConfigKeys(
      administration,
      ["allowedActions", "webhookCredentialDirectory"],
      "discordConversation.administration",
    );
  }
  const allowedActions =
    administration === undefined
      ? undefined
      : (boundedUniqueText(
          administration.allowedActions,
          "discordConversation.administration.allowedActions",
          /^(?:current_member\.nickname\.set|guild_text_channel\.create|public_thread\.create|incoming_webhook\.create)$/u,
          1,
          4,
        ) as Array<
          | "current_member.nickname.set"
          | "guild_text_channel.create"
          | "public_thread.create"
          | "incoming_webhook.create"
        >);
  const webhookCredentialDirectory =
    administration?.webhookCredentialDirectory === undefined
      ? undefined
      : resolve(
          baseDirectory,
          configText(
            administration.webhookCredentialDirectory,
            "discordConversation.administration.webhookCredentialDirectory",
          ),
        );
  if (
    allowedActions?.includes("incoming_webhook.create") === true &&
    webhookCredentialDirectory === undefined
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord webhook creation requires an owner-only credential directory.",
    );
  }
  const behavior = parseDiscordConversationBehavior({
    routing: source.routing,
    command: source.command,
    policy: source.policy,
  });
  const repositorySignals = parseDiscordRepositorySignals(
    source.repositorySignals,
    conversations.map((item) => item.conversationId),
  );
  const deliberation = parseDiscordConversationDeliberation(
    source.deliberation,
    baseDirectory,
    participants.filter((item) => item.actorKind === "human").map((item) => item.participantId),
  );
  if (
    deliberation?.notificationConversationIds !== undefined &&
    (deliberation.notificationConversationIds.some(
      (conversationId) => !conversations.some((item) => item.conversationId === conversationId),
    ) ||
      behavior.policy?.mode !== "proactive" ||
      !behavior.policy.respondTo?.includes("system") ||
      !["deliberation.completed", "deliberation.attention"].every((signalCode) =>
        behavior.policy!.signalCodes?.includes(signalCode),
      ))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord deliberation notifications require configured conversations and exact proactive system signal subscriptions.",
    );
  }
  if (
    repositorySignals !== undefined &&
    (behavior.policy?.mode !== "proactive" ||
      !behavior.policy.respondTo?.includes("system") ||
      repositorySignals.mappings.some(
        (mapping) => !behavior.policy!.signalCodes?.includes(mapping.signalCode),
      ))
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord repository signals require proactive mode and exact system signal subscriptions.",
    );
  }
  const conversationTenants = new Set(conversations.map((item) => item.tenantKey));
  if (
    conversations.some((item) =>
      item.tenantKey === "dm"
        ? !source.allowDirectMessages
        : !allowedGuildIds.includes(item.tenantKey),
    ) ||
    participants.some((item) =>
      item.tenantKey === "dm"
        ? !source.allowDirectMessages
        : !allowedGuildIds.includes(item.tenantKey),
    ) ||
    participants.some((item) => !conversationTenants.has(item.tenantKey)) ||
    conversations.some(
      (conversation) =>
        !participants.some((participant) => participant.tenantKey === conversation.tenantKey),
    )
  ) {
    throw new NodeRuntimeError("invalid_config", "Discord bindings exceed the allowed scope.");
  }
  const gateway =
    source.gateway === undefined ? undefined : configRecord(source.gateway, "gateway");
  if (gateway !== undefined)
    exactConfigKeys(
      gateway,
      ["url", "reconnectDelayMs", "maximumPayloadBytes", "maximumDispatchRecords"],
      "discordConversation.gateway",
    );
  const gatewayUrl =
    gateway?.url === undefined ? undefined : configText(gateway.url, "gateway.url");
  if (gatewayUrl !== undefined) {
    let url: URL;
    try {
      url = new URL(gatewayUrl);
    } catch (error) {
      throw new NodeRuntimeError("invalid_config", "discordConversation.gateway.url is invalid.", {
        cause: error,
      });
    }
    if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash) {
      throw new NodeRuntimeError(
        "invalid_config",
        "discordConversation.gateway.url must be a credential-free WSS URL.",
      );
    }
  }
  const http = source.http === undefined ? undefined : configRecord(source.http, "http");
  if (http !== undefined)
    exactConfigKeys(http, ["requestTimeoutMs", "maxResponseBytes"], "discordConversation.http");
  const optional = (
    target: Record<string, unknown> | undefined,
    key: string,
    minimum: number,
    maximum: number,
    label: string,
  ) =>
    target === undefined ? undefined : optionalConfigInteger(target, key, minimum, maximum, label);
  const reconnectDelayMs = optional(gateway, "reconnectDelayMs", 100, 300_000, "gateway");
  const maximumPayloadBytes = optional(gateway, "maximumPayloadBytes", 1_024, 4_194_304, "gateway");
  const maximumDispatchRecords = optional(gateway, "maximumDispatchRecords", 1, 100_000, "gateway");
  const requestTimeoutMs = optional(http, "requestTimeoutMs", 10, 300_000, "http");
  const maxResponseBytes = optional(http, "maxResponseBytes", 1_024, 16_777_216, "http");
  return {
    integrationId,
    applicationId,
    botTokenFile: resolve(
      baseDirectory,
      configText(source.botTokenFile, "discordConversation.botTokenFile"),
    ),
    intents: source.intents as number,
    allowedGuildIds,
    allowDirectMessages: source.allowDirectMessages,
    workerId,
    agentParticipantId,
    ...(agentId === undefined ? {} : { agentId }),
    ...(speaker === undefined ? {} : { speaker }),
    ...(organization === undefined ? {} : { organization }),
    conversations,
    participants,
    ...(peerAgents === undefined ? {} : { peerAgents }),
    ...(allowedActions === undefined
      ? {}
      : {
          administration: {
            allowedActions,
            ...(webhookCredentialDirectory === undefined ? {} : { webhookCredentialDirectory }),
          },
        }),
    ...behavior,
    ...(repositorySignals === undefined ? {} : { repositorySignals }),
    ...(deliberation === undefined ? {} : { deliberation }),
    ...(gateway === undefined
      ? {}
      : {
          gateway: {
            ...(gatewayUrl === undefined ? {} : { url: gatewayUrl }),
            ...(reconnectDelayMs === undefined ? {} : { reconnectDelayMs }),
            ...(maximumPayloadBytes === undefined ? {} : { maximumPayloadBytes }),
            ...(maximumDispatchRecords === undefined ? {} : { maximumDispatchRecords }),
          },
        }),
    ...(http === undefined
      ? {}
      : {
          http: {
            ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
            ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
          },
        }),
  };
}
