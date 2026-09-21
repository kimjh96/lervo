import {
  ConversationControlError,
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ManagedConversationSurfaceEffect } from "@lervo/conversation-responder";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationDiscussionRuntime } from "./conversation-discussion-runtime.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

export class ConversationDiscussionActionResponder implements DiscordPlatformActionResponder {
  readonly availableEffects = ["deliberation_start"] as const;
  readonly surfaceEffect: ManagedConversationSurfaceEffect = {
    effectId: "deliberation_start",
    description:
      "Convene a smallest sufficient roster of real, independently bound remote agents when the requester asks for multiple separate role- and context-grounded judgments, debate or comparison, and one converged synthesis. Select this action even when the topic concerns repository work, deployment, verification, or an external system; the participants perform any needed review after the governed discussion starts.",
    argumentDescription: "The complete topic to discuss, without agent personas or command syntax.",
    maximumArgumentCharacters: 4_096,
  };

  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      discussion: ConversationDiscussionRuntime;
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
        "The conversation participant cannot start this discussion.",
      );
    }
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const language = /\p{Script=Hangul}/u.test(request) ? ("ko" as const) : ("en" as const);
    const priorHumanContext = (input.context?.priorTurns ?? [])
      .filter((turn) => turn.speaker.kind === "human")
      .slice(-4)
      .map((turn) => turn.text.slice(0, 700));
    const topic = [
      effect.specification.trim(),
      ...(priorHumanContext.length === 0
        ? []
        : [priorHumanContext.map((text) => `- ${text}`).join("\n")]),
    ]
      .join("\n\n")
      .slice(0, 4_096)
      .trim();
    if (topic.length === 0 || topic.includes("\0")) {
      throw new ConversationControlError(
        "control_command_invalid",
        "The natural-language discussion topic is invalid.",
      );
    }
    const started = await this.options.discussion.start({ event: input.event, topic, language });
    const content =
      started.status === "started"
        ? started.content
        : language === "ko"
          ? `서로 독립된 실제 원격 에이전트가 2명 이상 확인되지 않아 토론을 시작하지 않았습니다. 확인된 원격 참여자는 ${started.participantCount}명이며, 공급자 호출이나 부분 토론은 실행되지 않았습니다.`
          : `I did not start the discussion because fewer than two independent real remote agents were verified. ${started.participantCount} remote participant(s) were verified; no provider call or partial discussion ran.`;
    const reply = await createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
    reply.deliveryRelation = "reply";
    if (started.status === "started") {
      reply.coordination = {
        kind: "discussion.assignment",
        discussionId: started.discussionId,
        activeParticipantId: started.participantIds[0]!,
        assignmentSequence: 1,
      };
      reply.audienceParticipation = "eligible";
    }
    return reply;
  }
}
