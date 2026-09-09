import { resolve } from "node:path";

import type { DiscordAdministrationPort } from "@lervo/adapter-discord";
import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { describe, expect, it, vi } from "vitest";

import { DiscordConversationAdministrationResponder } from "../src/discord-platform-action-responder.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

const guildId = "123456789012345678";
const channelId = "223456789012345678";

describe("Discord conversation administration responder", () => {
  it("executes only allowlisted channel and current-channel thread effects", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const source = await artifactStore.put("이 채널에 릴리스 검토 스레드를 만들어 주세요.");
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("discord-message-1"),
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_test0001",
        conversationId: "cnv_test0001",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_owner0001", roleId: null },
      mentions: { participantIds: [], roleIds: [] },
      content: {
        artifactId: "art_discord_message_1",
        contentHash: source.contentHash,
        byteCount: source.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-09-10T00:00:00.000Z",
    });
    const administration: DiscordAdministrationPort = {
      setCurrentMemberNickname: vi.fn(),
      createGuildTextChannel: vi.fn(async (input) => ({
        guildId: input.guildId,
        channelId: "323456789012345678",
        name: input.name,
        observedAt: "2026-09-10T00:00:01.000Z",
      })),
      createPublicThread: vi.fn(async (input) => ({
        guildId: input.guildId,
        parentChannelId: input.channelId,
        threadId: "423456789012345678",
        name: input.name,
        observedAt: "2026-09-10T00:00:01.000Z",
      })),
      createIncomingWebhook: vi.fn(),
    };
    const responder = new DiscordConversationAdministrationResponder({
      artifactStore,
      administration,
      conversations: [{ conversationId: "cnv_test0001", guildId, channelId }],
      allowNicknameUpdate: false,
      allowGuildTextChannelCreate: true,
      allowPublicThreadCreate: true,
    });
    const request = { event } as Parameters<
      DiscordConversationAdministrationResponder["respond"]
    >[0];

    await responder.respond(
      request,
      { kind: "discord_public_thread_create", name: "릴리스 검토" },
      { effectRequesterAuthorized: true },
    );
    expect(administration.createPublicThread).toHaveBeenCalledWith({
      guildId,
      channelId,
      name: "릴리스 검토",
      autoArchiveDuration: 1440,
    });

    await responder.respond(
      request,
      { kind: "discord_guild_text_channel_create", name: "release-room" },
      { effectRequesterAuthorized: true },
    );
    expect(administration.createGuildTextChannel).toHaveBeenCalledWith({
      guildId,
      name: "release-room",
      topic: null,
      parentChannelId: null,
    });
    expect(responder.availableEffects).toEqual([
      "none",
      "repository_work",
      "discord_guild_text_channel_create",
      "discord_public_thread_create",
    ]);
    await removeTemporaryRoots();
  });

  it("rejects an unadmitted agent requester before calling Discord", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const administration = {
      setCurrentMemberNickname: vi.fn(),
      createGuildTextChannel: vi.fn(),
      createPublicThread: vi.fn(),
      createIncomingWebhook: vi.fn(),
    } satisfies DiscordAdministrationPort;
    const responder = new DiscordConversationAdministrationResponder({
      artifactStore,
      administration,
      conversations: [{ conversationId: "cnv_test0001", guildId, channelId }],
      allowNicknameUpdate: false,
      allowGuildTextChannelCreate: false,
      allowPublicThreadCreate: true,
    });

    await expect(
      responder.respond(
        { event: { target: { conversationId: "cnv_test0001" } } } as never,
        { kind: "discord_public_thread_create", name: "Unauthorized" },
        { effectRequesterAuthorized: false },
      ),
    ).rejects.toThrow("not authorized");
    expect(administration.createPublicThread).not.toHaveBeenCalled();
    await removeTemporaryRoots();
  });
});
