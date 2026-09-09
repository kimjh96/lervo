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
  private readonly targetsByConversation = new Map<
    string,
    { guildId: string; channelId: string }
  >();

  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      administration: DiscordAdministrationPort;
      conversations: readonly { conversationId: string; guildId: string; channelId: string }[];
      allowNicknameUpdate: boolean;
      allowGuildTextChannelCreate: boolean;
      allowPublicThreadCreate: boolean;
      now?: () => Date;
    },
  ) {
    this.availableEffects = [
      "none",
      "repository_work",
      ...(options.allowNicknameUpdate ? (["discord_current_member_nickname_set"] as const) : []),
      ...(options.allowGuildTextChannelCreate
        ? (["discord_guild_text_channel_create"] as const)
        : []),
      ...(options.allowPublicThreadCreate ? (["discord_public_thread_create"] as const) : []),
    ];
    for (const binding of options.conversations) {
      if (binding.guildId !== "dm") {
        this.targetsByConversation.set(binding.conversationId, {
          guildId: binding.guildId,
          channelId: binding.channelId,
        });
      }
    }
  }

  async respond(
    input: Parameters<ConversationResponder["respond"]>[0],
    effect: Exclude<ConversationRequestedEffect, { kind: "none" | "repository_work" }>,
    authorization: { effectRequesterAuthorized: boolean },
  ) {
    if (!authorization.effectRequesterAuthorized) {
      throw new Error("The Discord administration action is not authorized.");
    }
    const target = this.targetsByConversation.get(input.event.target.conversationId);
    if (target === undefined) {
      throw new Error("The Discord administration target is not a configured guild.");
    }
    const message = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    const korean = /\p{Script=Hangul}/u.test(message);
    let content: string;
    if (effect.kind === "discord_current_member_nickname_set") {
      if (!this.options.allowNicknameUpdate) {
        throw new Error("The Discord administration action is not authorized.");
      }
      const result = await this.options.administration.setCurrentMemberNickname({
        guildId: target.guildId,
        nickname: effect.nickname,
      });
      content = korean
        ? `네, 이 서버에서 제 표시 이름 변경을 완료했습니다. 현재 이름은 "${result.nickname}"입니다.`
        : `Done. I changed my display name in this server to ${result.nickname}.`;
    } else if (effect.kind === "discord_guild_text_channel_create") {
      if (!this.options.allowGuildTextChannelCreate) {
        throw new Error("The Discord administration action is not authorized.");
      }
      const result = await this.options.administration.createGuildTextChannel({
        guildId: target.guildId,
        name: effect.name,
        topic: null,
        parentChannelId: null,
      });
      content = korean
        ? `네, 이 서버에 #${result.name} 채널을 만들었습니다.`
        : `Done. I created the #${result.name} channel in this server.`;
    } else {
      if (!this.options.allowPublicThreadCreate) {
        throw new Error("The Discord administration action is not authorized.");
      }
      const result = await this.options.administration.createPublicThread({
        guildId: target.guildId,
        channelId: target.channelId,
        name: effect.name,
        autoArchiveDuration: 1440,
      });
      content = korean
        ? `네, 현재 채널에 "${result.name}" 스레드를 만들었습니다.`
        : `Done. I created the ${result.name} thread under this channel.`;
    }
    return createVerifiedConversationControlReply({
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      content,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
