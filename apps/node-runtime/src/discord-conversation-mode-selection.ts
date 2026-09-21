import type { ManagedConversationTurnResolution } from "@lervo/conversation-responder";

import type {
  ConversationIntentResolution,
  ConversationRequestedEffect,
} from "./conversation-intent-resolver.js";
import type { DiscordConversationMode } from "./discord-conversation-mode.js";

export function withoutLeadingBotMention(message: string, applicationId: string): string {
  return message
    .trimStart()
    .replace(new RegExp(`^<@!?${applicationId}>\\s*`, "u"), "")
    .trimStart();
}

export function modeForConversationResolution(
  resolution: ConversationIntentResolution,
): DiscordConversationMode {
  return resolution.intent === "continue_work" && resolution.confidence !== "low"
    ? resolution.effect.kind === "repository_work"
      ? "work"
      : resolution.effect.kind === "supervision_goal_request"
        ? "goal"
        : "platform_action"
    : resolution.intent === "clarify" || resolution.confidence === "low"
      ? "clarify"
      : "read_only";
}

export function effectForManagedConversationResolution(
  effect: ManagedConversationTurnResolution["effect"],
): ConversationRequestedEffect {
  switch (effect.kind) {
    case "discord_current_member_nickname_set":
      return { kind: effect.kind, nickname: effect.argument! };
    case "discord_guild_text_channel_create":
    case "discord_public_thread_create":
      return { kind: effect.kind, name: effect.argument! };
    case "workforce_agent_hire":
    case "workforce_task_delegate":
    case "deliberation_start":
    case "requested_runtime_open":
    case "requested_runtime_close":
      return { kind: effect.kind, specification: effect.argument! };
    case "repository_work":
      return { kind: effect.kind };
    case "supervision_goal_request":
      return { kind: effect.kind };
    default:
      return { kind: "none" };
  }
}
