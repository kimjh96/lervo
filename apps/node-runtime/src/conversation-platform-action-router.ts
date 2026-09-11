import type { ConversationResponder } from "@lervo/interaction";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

type ActionEffect = Exclude<ConversationRequestedEffect, { kind: "none" | "repository_work" }>;

export class ConversationPlatformActionRouter implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][];

  constructor(
    private readonly discord: DiscordPlatformActionResponder,
    private readonly workforce?: DiscordPlatformActionResponder,
  ) {
    this.availableEffects = [
      ...new Set([...discord.availableEffects, ...(workforce?.availableEffects ?? [])]),
    ];
  }

  respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: ActionEffect,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    return effect.kind === "workforce_agent_hire"
      ? this.requireWorkforce().respond(input, effect, authorization)
      : this.discord.respond(input, effect, authorization);
  }

  private requireWorkforce(): DiscordPlatformActionResponder {
    if (this.workforce === undefined) {
      throw new Error("The conversation workforce action is not configured.");
    }
    return this.workforce;
  }
}
