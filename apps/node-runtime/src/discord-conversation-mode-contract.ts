import type { ConversationReplyCandidate, ConversationResponder } from "@lervo/interaction";
import type { ConversationContextTurn } from "@lervo/conversation-responder";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";

type NonPlatformEffect =
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" };

export interface DiscordPlatformActionResponder {
  readonly availableEffects: readonly ConversationRequestedEffect["kind"][];
  readonly managedResultEffects?: readonly ConversationRequestedEffect["kind"][];
  respond(
    input: Omit<Parameters<ConversationResponder["respond"]>[0], "context"> & {
      context?: { priorTurns: ReadonlyArray<ConversationContextTurn> };
    },
    effect: Exclude<ConversationRequestedEffect, NonPlatformEffect>,
    authorization: { effectRequesterAuthorized: boolean },
  ): ReturnType<ConversationResponder["respond"]>;
}

export interface DiscordGoalResponder extends ConversationResponder {
  respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    admittedReplyCandidate?: ConversationReplyCandidate | null,
  ): ReturnType<ConversationResponder["respond"]>;
}

export type DiscordNonPlatformEffect = NonPlatformEffect;
