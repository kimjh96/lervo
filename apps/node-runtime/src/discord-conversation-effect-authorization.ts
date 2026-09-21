import type { ConversationInboundEvent } from "@lervo/schemas";

import type {
  ConversationIntentResolution,
  ConversationRequestedEffect,
} from "./conversation-intent-resolver.js";
import { modeForConversationResolution } from "./discord-conversation-mode-selection.js";
import type { DiscordConversationMode } from "./discord-conversation-mode.js";

export interface AuthorizedAgentEffectRequester {
  participantId: string;
  roleId: string;
  conversationId: string;
  effectKinds: readonly ConversationRequestedEffect["kind"][];
}

export function isConversationEffectRequesterAuthorized(input: {
  event: ConversationInboundEvent;
  effectKind: ConversationRequestedEffect["kind"];
  requesters?: readonly AuthorizedAgentEffectRequester[];
}): boolean {
  return (
    input.event.actor.kind === "human" ||
    input.requesters?.some(
      (requester) =>
        requester.participantId === input.event.actor.participantId &&
        requester.roleId === input.event.actor.roleId &&
        requester.conversationId === input.event.target.conversationId &&
        requester.effectKinds.includes(input.effectKind),
    ) === true
  );
}

export function admittedConversationMode(input: {
  event: ConversationInboundEvent;
  resolution: ConversationIntentResolution;
  requesters?: readonly AuthorizedAgentEffectRequester[];
  goalAvailable: boolean;
}): DiscordConversationMode {
  const mode = modeForConversationResolution(input.resolution);
  if (mode === "goal" && !input.goalAvailable) return "clarify";
  if (
    !["work", "continuation", "platform_action"].includes(mode) ||
    input.event.actor.kind === "human"
  ) {
    return mode;
  }
  return isConversationEffectRequesterAuthorized({
    event: input.event,
    effectKind: input.resolution.effect.kind,
    ...(input.requesters === undefined ? {} : { requesters: input.requesters }),
  })
    ? mode
    : "clarify";
}
