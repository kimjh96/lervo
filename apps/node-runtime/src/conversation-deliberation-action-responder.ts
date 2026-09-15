import {
  ConversationControlError,
  createConversationDeliberationResponse,
  createVerifiedConversationControlReply,
  type ConversationDeliberationPort,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

export class ConversationDeliberationActionResponder implements DiscordPlatformActionResponder {
  readonly availableEffects = ["deliberation_start"] as const;
  readonly surfaceEffect: ManagedConversationSurfaceEffect = {
    effectId: "deliberation_start",
    description:
      "Start a governed multi-agent deliberation for a topic that benefits from independent challenge and a verified decision.",
    argumentDescription: "The complete topic to deliberate, without command syntax.",
    maximumArgumentCharacters: 4_096,
  };

  constructor(
    private readonly options: {
      policyId: string;
      artifactStore: ArtifactStore;
      deliberations(): ConversationDeliberationPort | null;
      now?: () => Date;
    },
  ) {}

  async respond(
    input: Parameters<DiscordPlatformActionResponder["respond"]>[0],
    effect: Parameters<DiscordPlatformActionResponder["respond"]>[1],
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    if (effect.kind !== "deliberation_start" || !authorization.effectRequesterAuthorized) {
      throw new ConversationControlError(
        "control_access_denied",
        "The conversation participant cannot start this deliberation.",
      );
    }
    const topic = effect.specification.trim();
    if (topic.length === 0 || [...topic].length > 4_096 || topic.includes("\0")) {
      throw new ConversationControlError(
        "control_command_invalid",
        "The natural-language deliberation topic is invalid.",
      );
    }
    const content = await createConversationDeliberationResponse({
      deliberations: this.options.deliberations() ?? undefined,
      event: input.event,
      command: {
        operation: "deliberation_start",
        policyId: this.options.policyId,
        topic,
      },
      at: (this.options.now?.() ?? new Date()).toISOString(),
    });
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
