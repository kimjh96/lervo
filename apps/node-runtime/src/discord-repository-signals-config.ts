import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

function conversationIds(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 64 ||
    value.some(
      (item) => typeof item !== "string" || !/^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(item),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return [...value] as string[];
}

export function parseDiscordRepositorySignals(
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
    const label = `repositorySignals.mappings[${index}]`;
    const mapping = configRecord(value, label);
    exactConfigKeys(mapping, ["eventType", "signalCode", "conversationIds"], label);
    const eventType = configText(mapping.eventType, `${label}.eventType`);
    const signalCode = configText(mapping.signalCode, `${label}.signalCode`);
    const scopedConversationIds =
      mapping.conversationIds === undefined
        ? undefined
        : conversationIds(mapping.conversationIds, `${label}.conversationIds`);
    if (
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(eventType) ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(signalCode) ||
      scopedConversationIds?.some(
        (conversationId) => !configuredConversationIds.includes(conversationId),
      )
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "Discord repository signal mappings are invalid.",
      );
    }
    return {
      eventType,
      signalCode,
      ...(scopedConversationIds === undefined ? {} : { conversationIds: scopedConversationIds }),
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
