import type { ConversationResponder } from "@lervo/interaction";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { ConversationRequestedRuntimeManager } from "./conversation-requested-runtime.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

function failedRuntimeObservation(
  opening: boolean,
  error: unknown,
): { resultCode: string; facts: string[] } {
  if (!opening) {
    return {
      resultCode: "stop_failed",
      facts: [
        "The configured runtime could not be confirmed stopped.",
        "No successful stop was recorded.",
      ],
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (message === "The requested runtime exited before readiness.") {
    return {
      resultCode: "startup_exited",
      facts: [
        "The configured runtime process exited before its readiness check succeeded.",
        "No successful start was recorded.",
      ],
    };
  }
  if (message === "The requested runtime did not become ready before its startup deadline.") {
    return {
      resultCode: "startup_timeout",
      facts: [
        "The configured runtime did not pass its readiness check before the configured startup deadline.",
        "No successful start was recorded.",
      ],
    };
  }
  return {
    resultCode: "start_failed",
    facts: ["The configured runtime could not be started.", "No successful start was recorded."],
  };
}

export class ConversationRequestedRuntimeResponder implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][] = [
    "requested_runtime_open",
    "requested_runtime_close",
  ];
  readonly managedResultEffects = this.availableEffects;

  constructor(
    private readonly manager: ConversationRequestedRuntimeManager,
    private readonly resultResponder: ConversationResponder,
  ) {}

  async respond(
    input: Parameters<DiscordPlatformActionResponder["respond"]>[0],
    effect: Parameters<DiscordPlatformActionResponder["respond"]>[1],
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    if (
      !authorization.effectRequesterAuthorized ||
      !["requested_runtime_open", "requested_runtime_close"].includes(effect.kind)
    ) {
      throw new Error("The requested runtime action is not authorized.");
    }
    const runtimeId = "specification" in effect ? effect.specification.trim() : "";
    const target = this.manager.target(runtimeId);
    const opening = effect.kind === "requested_runtime_open";
    let resultCode: string;
    let facts: string[];
    try {
      const result = opening
        ? await this.manager.open(runtimeId)
        : await this.manager.close(runtimeId);
      resultCode = result;
      facts =
        result === "opened"
          ? [
              "The configured runtime started successfully.",
              "Its configured startup readiness contract completed.",
              "It was not enabled at boot or configured for unconditional restart.",
            ]
          : result === "already_open"
            ? ["The configured runtime was already running."]
            : result === "closed"
              ? ["The configured runtime stopped successfully."]
              : ["The configured runtime was already stopped."];
    } catch (error) {
      ({ resultCode, facts } = failedRuntimeObservation(opening, error));
    }
    return this.resultResponder.respond({
      ...input,
      context: {
        priorTurns: input.context?.priorTurns ?? [],
        completedEffect: {
          effectId: effect.kind,
          resultCode,
          targetLabel: target.displayName,
          facts,
        },
      },
    });
  }
}
