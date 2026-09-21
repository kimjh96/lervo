import {
  ConversationControlError,
  createConversationDeliberationResponse,
  createVerifiedConversationControlReply,
  readConversationControlMessage,
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
      preflight(input: { policyId: string; projectId: string; conversationId: string }): {
        participantIds: string[];
      };
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
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const responseLanguage = /\p{Script=Hangul}/u.test(request) ? ("ko" as const) : ("en" as const);
    const participantPlan = this.options.preflight({
      policyId: this.options.policyId,
      projectId: input.event.target.projectId,
      conversationId: input.event.target.conversationId,
    });
    if (participantPlan.participantIds.length < 2) {
      const content =
        responseLanguage === "ko"
          ? `서로 독립된 실제 에이전트가 2명 이상 확인되지 않아 다중 에이전트 토론을 시작하지 않았습니다. 확인된 참여자는 ${participantPlan.participantIds.length}명이며, 공급자 호출이나 부분 토론은 실행되지 않았습니다.`
          : `I did not start a multi-agent discussion because fewer than two independent real agents were verified. ${participantPlan.participantIds.length} participant(s) were verified; no provider call or partial discussion ran.`;
      const reply = await createVerifiedConversationControlReply({
        artifactStore: this.options.artifactStore,
        writingContract: fixedConversationStatusWritingContract,
        content,
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
      });
      reply.deliveryRelation = "reply";
      return reply;
    }
    const priorHumanContext = (input.context?.priorTurns ?? [])
      .filter((turn) => turn.speaker.kind === "human")
      .slice(-4)
      .map((turn) => turn.text.slice(0, 700));
    const unboundedTopic = [
      `Resolved review scope:\n${effect.specification.trim()}`,
      `Current human request:\n${request.trim()}`,
      ...(priorHumanContext.length === 0
        ? []
        : [
            `Relevant prior human context:\n${priorHumanContext.map((text) => `- ${text}`).join("\n")}`,
          ]),
    ].join("\n\n");
    const topic = [...unboundedTopic].slice(0, 4_096).join("");
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
      presentation: "product",
      responseLanguage,
    });
    const reply = await createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    reply.deliveryRelation = "reply";
    return reply;
  }
}
