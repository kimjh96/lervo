import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

type ActionEffect = Exclude<
  ConversationRequestedEffect,
  { kind: "none" } | { kind: "repository_work" } | { kind: "supervision_goal_request" }
>;

export class ConversationPlatformActionRouter implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][];
  readonly managedResultEffects: ConversationRequestedEffect["kind"][];

  constructor(
    private readonly discord: DiscordPlatformActionResponder,
    private readonly workforce?: DiscordPlatformActionResponder,
    private readonly delegate?: DiscordPlatformActionResponder,
    private readonly deliberation?: DiscordPlatformActionResponder,
    private readonly requestedRuntime?: DiscordPlatformActionResponder,
  ) {
    this.availableEffects = [
      ...new Set([
        ...discord.availableEffects,
        ...(workforce?.availableEffects ?? []),
        ...(delegate?.availableEffects ?? []),
        ...(deliberation?.availableEffects ?? []),
        ...(requestedRuntime?.availableEffects ?? []),
      ]),
    ];
    this.managedResultEffects = [
      ...new Set([
        ...(discord.managedResultEffects ?? []),
        ...(workforce?.managedResultEffects ?? []),
        ...(delegate?.managedResultEffects ?? []),
        ...(deliberation?.managedResultEffects ?? []),
        ...(requestedRuntime?.managedResultEffects ?? []),
      ]),
    ];
  }

  respond(
    input: Parameters<DiscordPlatformActionResponder["respond"]>[0],
    effect: ActionEffect,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    return effect.kind === "workforce_agent_hire"
      ? this.requireWorkforce().respond(input, effect, authorization)
      : effect.kind === "workforce_task_delegate"
        ? this.requireDelegate().respond(input, effect, authorization)
        : effect.kind === "deliberation_start"
          ? this.requireDeliberation().respond(input, effect, authorization)
          : ["requested_runtime_open", "requested_runtime_close"].includes(effect.kind)
            ? this.requireRequestedRuntime().respond(input, effect, authorization)
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

  private requireDeliberation(): DiscordPlatformActionResponder {
    if (this.deliberation === undefined) {
      throw new Error("The conversation deliberation action is not configured.");
    }
    return this.deliberation;
  }

  private requireRequestedRuntime(): DiscordPlatformActionResponder {
    if (this.requestedRuntime === undefined) {
      throw new Error("The requested runtime action is not configured.");
    }
    return this.requestedRuntime;
  }
}
