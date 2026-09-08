import type { DiscordAdministrationPort } from "@lervo/adapter-discord";
import {
  createVerifiedConversationControlReply,
  readConversationControlMessage,
} from "@lervo/conversation-control";
import { fixedConversationStatusWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationRequestedEffect } from "./conversation-intent-resolver.js";
import type { DiscordPlatformActionResponder } from "./discord-conversation-mode.js";

export class DiscordConversationAdministrationResponder implements DiscordPlatformActionResponder {
  readonly availableEffects: ConversationRequestedEffect["kind"][];
  private readonly guildByConversation = new Map<string, string>();

  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      administration: DiscordAdministrationPort;
      conversations: readonly { conversationId: string; guildId: string }[];
      allowNicknameUpdate: boolean;
      now?: () => Date;
    },
  ) {
    this.availableEffects = [
      "none",
      "repository_work",
      ...(options.allowNicknameUpdate ? (["discord_current_member_nickname_set"] as const) : []),
    ];
    for (const binding of options.conversations) {
      if (binding.guildId !== "dm") {
        this.guildByConversation.set(binding.conversationId, binding.guildId);
      }
    }
  }

  async respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Extract<ConversationRequestedEffect, { kind: "discord_current_member_nickname_set" }>,
  ) {
    if (!this.options.allowNicknameUpdate || input.event.actor.kind !== "human") {
      throw new Error("The Discord administration action is not authorized.");
    }
    const guildId = this.guildByConversation.get(input.event.target.conversationId);
    if (guildId === undefined) {
      throw new Error("The Discord administration target is not a configured guild.");
    }
    const message = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const result = await this.options.administration.setCurrentMemberNickname({
      guildId,
      nickname: effect.nickname,
    });
    const korean = /\p{Script=Hangul}/u.test(message);
    const content = korean
      ? `네, 이 서버에서 제 표시 이름 변경을 완료했습니다. 현재 이름은 "${result.nickname}"입니다.`
      : `Done. I changed my display name in this server to ${result.nickname}.`;
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
