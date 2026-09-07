import { resolve } from "node:path";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const INTEGRATION_ID = /^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const SNOWFLAKE = /^[0-9]{1,32}$/u;
const CONVERSATION_ID = /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
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

function nullableIdentifier(value: unknown, label: string, pattern: RegExp): string | null {
  if (value === undefined || value === null) return null;
  const result = configText(value, label);
  if (!pattern.test(result)) throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  return result;
}

function parseConversations(value: unknown): NodeDiscordConversationConfig["conversations"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new NodeRuntimeError("invalid_config", "discordConversation.conversations is invalid.");
  }
  const parsed = value.map((item, index) => {
    const source = configRecord(item, `discordConversation.conversations[${index}]`);
    exactConfigKeys(
      source,
      ["tenantKey", "conversationKey", "conversationId"],
      `discordConversation.conversations[${index}]`,
    );
    const tenantKey = configText(source.tenantKey, "conversation tenantKey");
    const conversationKey = configText(source.conversationKey, "conversation conversationKey");
    const conversationId = configText(source.conversationId, "conversation conversationId");
    if (
      !(tenantKey === "dm" || SNOWFLAKE.test(tenantKey)) ||
      !SNOWFLAKE.test(conversationKey) ||
      !CONVERSATION_ID.test(conversationId)
    ) {
      throw new NodeRuntimeError("invalid_config", "A Discord conversation binding is invalid.");
    }
    return { tenantKey, conversationKey, conversationId };
  });
  if (
    new Set(parsed.map((item) => `${item.tenantKey}\0${item.conversationKey}`)).size !==
      parsed.length ||
    new Set(parsed.map((item) => item.conversationId)).size !== parsed.length
  ) {
    throw new NodeRuntimeError("invalid_config", "Discord conversation bindings must be unique.");
  }
  return parsed;
}

function parseParticipants(value: unknown): NodeDiscordConversationConfig["participants"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new NodeRuntimeError("invalid_config", "discordConversation.participants is invalid.");
  }
  const parsed = value.map((item, index) => {
    const source = configRecord(item, `discordConversation.participants[${index}]`);
    exactConfigKeys(
      source,
      ["tenantKey", "userId", "participantId"],
      `discordConversation.participants[${index}]`,
    );
    const tenantKey = configText(source.tenantKey, "participant tenantKey");
    const userId = configText(source.userId, "participant userId");
    const participantId = configText(source.participantId, "participant participantId");
    if (
      !(tenantKey === "dm" || SNOWFLAKE.test(tenantKey)) ||
      !SNOWFLAKE.test(userId) ||
      !PARTICIPANT_ID.test(participantId)
    ) {
      throw new NodeRuntimeError("invalid_config", "A Discord participant binding is invalid.");
    }
    return { tenantKey, userId, participantId };
  });
  if (new Set(parsed.map((item) => `${item.tenantKey}\0${item.userId}`)).size !== parsed.length) {
    throw new NodeRuntimeError("invalid_config", "Discord participant bindings must be unique.");
  }
  return parsed;
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
      "conversations",
      "participants",
      "command",
      "gateway",
      "http",
      "policy",
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
  if (
    !INTEGRATION_ID.test(integrationId) ||
    !SNOWFLAKE.test(applicationId) ||
    !IDENTIFIER.test(workerId) ||
    !PARTICIPANT_ID.test(agentParticipantId) ||
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
  const conversations = parseConversations(source.conversations);
  const participants = parseParticipants(source.participants);
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
  const command = configRecord(source.command, "discordConversation.command");
  exactConfigKeys(
    command,
    ["roleId", "provider", "risk", "verificationSuiteIds", "lifetimeMs", "assignmentId", "agentId"],
    "discordConversation.command",
  );
  const roleId = configText(command.roleId, "discordConversation.command.roleId");
  if (
    !IDENTIFIER.test(roleId) ||
    !["codex", "claude"].includes(command.provider as string) ||
    !["low", "medium", "high"].includes(command.risk as string) ||
    !Number.isSafeInteger(command.lifetimeMs) ||
    (command.lifetimeMs as number) < 1_000 ||
    (command.lifetimeMs as number) > 300_000
  ) {
    throw new NodeRuntimeError("invalid_config", "The Discord command policy is invalid.");
  }
  const verificationSuiteIds = boundedUniqueText(
    command.verificationSuiteIds,
    "discordConversation.command.verificationSuiteIds",
    IDENTIFIER,
    1,
    16,
  );
  const assignmentId = nullableIdentifier(
    command.assignmentId,
    "discordConversation.command.assignmentId",
    /^asn_[a-f0-9]{24}$/u,
  );
  const agentId = nullableIdentifier(
    command.agentId,
    "discordConversation.command.agentId",
    /^agt_[a-f0-9]{24}$/u,
  );
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
  const policy = source.policy === undefined ? undefined : configRecord(source.policy, "policy");
  if (policy !== undefined)
    exactConfigKeys(
      policy,
      ["cooldownSeconds", "maxResponsesPerHour", "maxAutomationDepth"],
      "discordConversation.policy",
    );
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
  const cooldownSeconds = optional(policy, "cooldownSeconds", 0, 86_400, "policy");
  const maxResponsesPerHour = optional(policy, "maxResponsesPerHour", 1, 10_000, "policy");
  const maxAutomationDepth = optional(policy, "maxAutomationDepth", 0, 32, "policy");
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
    conversations,
    participants,
    command: {
      roleId,
      provider: command.provider as "codex" | "claude",
      risk: command.risk as "low" | "medium" | "high",
      verificationSuiteIds,
      lifetimeMs: command.lifetimeMs as number,
      assignmentId,
      agentId,
    },
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
    ...(policy === undefined
      ? {}
      : {
          policy: {
            ...(cooldownSeconds === undefined ? {} : { cooldownSeconds }),
            ...(maxResponsesPerHour === undefined ? {} : { maxResponsesPerHour }),
            ...(maxAutomationDepth === undefined ? {} : { maxAutomationDepth }),
          },
        }),
  };
}
