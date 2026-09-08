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
      "organization",
      "conversations",
      "participants",
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
  const administration =
    source.administration === undefined
      ? undefined
      : configRecord(source.administration, "discordConversation.administration");
  if (administration !== undefined) {
    exactConfigKeys(administration, ["allowedActions"], "discordConversation.administration");
  }
  const allowedActions =
    administration === undefined
      ? undefined
      : (boundedUniqueText(
          administration.allowedActions,
          "discordConversation.administration.allowedActions",
          /^(?:current_member\.nickname\.set|guild_text_channel\.create|public_thread\.create)$/u,
          1,
          3,
        ) as Array<
          "current_member.nickname.set" | "guild_text_channel.create" | "public_thread.create"
        >);
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
    ...(organization === undefined ? {} : { organization }),
    conversations,
    participants,
    ...(allowedActions === undefined ? {} : { administration: { allowedActions } }),
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

function parseDiscordRepositorySignals(
  value: unknown,
  configuredConversationIds: readonly string[],
): NodeDiscordConversationConfig["repositorySignals"] {
  if (value === undefined) return undefined;
  const source = configRecord(value, "discordConversation.repositorySignals");
  exactConfigKeys(source, ["pollIntervalMs", "mappings"], "discordConversation.repositorySignals");
  const pollIntervalMs = optionalConfigInteger(
    source,
    "pollIntervalMs",
    100,
    60_000,
    "discordConversation.repositorySignals",
  );
  if (
    !Array.isArray(source.mappings) ||
    source.mappings.length < 1 ||
    source.mappings.length > 64
  ) {
    throw new NodeRuntimeError("invalid_config", "Discord repository signal mappings are invalid.");
  }
  const mappings = source.mappings.map((value, index) => {
    const mapping = configRecord(value, `repositorySignals.mappings[${index}]`);
    exactConfigKeys(
      mapping,
      ["eventType", "signalCode", "conversationIds"],
      `repositorySignals.mappings[${index}]`,
    );
    const eventType = configText(
      mapping.eventType,
      `repositorySignals.mappings[${index}].eventType`,
    );
    const signalCode = configText(
      mapping.signalCode,
      `repositorySignals.mappings[${index}].signalCode`,
    );
    const conversationIds =
      mapping.conversationIds === undefined
        ? undefined
        : boundedUniqueText(
            mapping.conversationIds,
            `repositorySignals.mappings[${index}].conversationIds`,
            /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u,
            1,
            64,
          );
    if (
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(eventType) ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(signalCode) ||
      conversationIds?.some((conversationId) => !configuredConversationIds.includes(conversationId))
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord repository signal mappings are invalid.",
      );
    }
    return {
      eventType,
      signalCode,
      ...(conversationIds === undefined ? {} : { conversationIds }),
    };
  });
  if (
    new Set(mappings.map((item) => `${item.eventType}:${item.signalCode}`)).size !== mappings.length
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord repository signal mappings must be unique.",
    );
  }
  return {
    mappings,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
  };
}
