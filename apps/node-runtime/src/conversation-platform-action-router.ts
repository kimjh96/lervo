import type { ConversationResponder } from "@lervo/interaction";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

type ActionEffect = Exclude<
  ConversationRequestedEffect,
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" }
>;

export class ConversationPlatformActionRouter implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][];

  constructor(
    private readonly discord: DiscordPlatformActionResponder,
    private readonly workforce?: DiscordPlatformActionResponder,
    private readonly delegate?: DiscordPlatformActionResponder,
  ) {
    this.availableEffects = [
      ...new Set([
        ...discord.availableEffects,
        ...(workforce?.availableEffects ?? []),
        ...(delegate?.availableEffects ?? []),
      ]),
    ];
  }

  respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: ActionEffect,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    return effect.kind === "workforce_agent_hire"
      ? this.requireWorkforce().respond(input, effect, authorization)
      : effect.kind === "workforce_task_delegate"
        ? this.requireDelegate().respond(input, effect, authorization)
        : this.discord.respond(input, effect, authorization);
  }

  private requireWorkforce(): DiscordPlatformActionResponder {
    if (this.workforce === undefined) {
      throw new Error("The conversation workforce action is not configured.");
    }
    return this.workforce;
  }

  private requireDelegate(): DiscordPlatformActionResponder {
    if (this.delegate === undefined) {
      throw new Error("The conversation delegation action is not configured.");
    }
    return this.delegate;
  }
}
