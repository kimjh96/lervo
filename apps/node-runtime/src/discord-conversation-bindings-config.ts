import type { NodeDiscordConversationConfig } from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const SNOWFLAKE = /^[0-9]{1,32}$/u;
const CONVERSATION_ID = /^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const PARTICIPANT_ID = /^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export function parseDiscordConversationBindings(
  value: unknown,
): NodeDiscordConversationConfig["conversations"] {
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

export function parseDiscordParticipantBindings(
  value: unknown,
): NodeDiscordConversationConfig["participants"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new NodeRuntimeError("invalid_config", "discordConversation.participants is invalid.");
  }
  const parsed = value.map((item, index) => {
    const source = configRecord(item, `discordConversation.participants[${index}]`);
    exactConfigKeys(
      source,
      ["tenantKey", "userId", "participantId", "actorKind", "roleId", "startsAutomationChain"],
      `discordConversation.participants[${index}]`,
    );
    const tenantKey = configText(source.tenantKey, "participant tenantKey");
    const userId = configText(source.userId, "participant userId");
    const participantId = configText(source.participantId, "participant participantId");
    const actorKind = source.actorKind === undefined ? "human" : source.actorKind;
    const roleId =
      source.roleId === undefined || source.roleId === null
        ? null
        : configText(source.roleId, "participant roleId");
    const startsAutomationChain = source.startsAutomationChain;
    if (
      !(tenantKey === "dm" || SNOWFLAKE.test(tenantKey)) ||
      !SNOWFLAKE.test(userId) ||
      !PARTICIPANT_ID.test(participantId) ||
      !["human", "agent"].includes(actorKind as string) ||
      (actorKind === "human" ? roleId !== null : roleId === null) ||
      (roleId !== null && !IDENTIFIER.test(roleId)) ||
      (startsAutomationChain !== undefined && typeof startsAutomationChain !== "boolean") ||
      (startsAutomationChain === true && actorKind !== "agent")
    ) {
      throw new NodeRuntimeError("invalid_config", "A Discord participant binding is invalid.");
    }
    return {
      tenantKey,
      userId,
      participantId,
      actorKind: actorKind as "human" | "agent",
      roleId,
      ...(startsAutomationChain === true ? { startsAutomationChain: true } : {}),
    };
  });
  if (new Set(parsed.map((item) => `${item.tenantKey}\0${item.userId}`)).size !== parsed.length) {
    throw new NodeRuntimeError("invalid_config", "Discord participant bindings must be unique.");
  }
  return parsed;
}
