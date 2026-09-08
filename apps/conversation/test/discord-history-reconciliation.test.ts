import type { DiscordConversationAdapter, DiscordHistoryMessage } from "@lervo/adapter-discord";
import type { ConversationPlatformIngressCursorPort } from "@lervo/conversation-platform";
import type { ConversationInboundEvent } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  DiscordConversationIngressProcessor,
  reconcileDiscordConversationHistory,
} from "../src/discord-ingress.js";

const address = {
  platform: "discord" as const,
  integrationId: "itg_discord01",
  tenantKey: "123456789012345678",
  conversationKey: "223456789012345678",
};

class MemoryCursor implements ConversationPlatformIngressCursorPort {
  cursor: string | null = "323456789012345678";

  async readIngressCursor(): Promise<string | null> {
    return this.cursor;
  }

  async advanceIngressCursor(
    input: Parameters<ConversationPlatformIngressCursorPort["advanceIngressCursor"]>[0],
  ): Promise<void> {
    if (input.expectedCursor !== this.cursor) throw new Error("cursor conflict");
    this.cursor = input.cursor;
  }
}

function historyMessage(messageId: string): DiscordHistoryMessage {
  return { messageId, body: Buffer.from("{}") };
}

describe("Discord history reconciliation", () => {
  it("replays messages oldest-first through the accepted ingress processor", async () => {
    const cursors = new MemoryCursor();
    const accepted: string[] = [];
    const receiveHistoryMessage = vi.fn(async (message: DiscordHistoryMessage) => ({
      status: "accepted" as const,
      event: { eventId: message.messageId } as ConversationInboundEvent,
      responseActivity: null,
      checkpoint: {
        tenantKey: address.tenantKey,
        channelId: address.conversationKey,
        messageId: message.messageId,
      },
    }));
    const adapter = { receiveHistoryMessage } as unknown as DiscordConversationAdapter;
    const processor = new DiscordConversationIngressProcessor({
      integrationId: address.integrationId,
      adapter,
      cursors,
      handleAccepted: async (result) => {
        accepted.push(result.event.eventId);
      },
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([
        historyMessage("523456789012345678"),
        historyMessage("423456789012345678"),
      ])
      .mockResolvedValueOnce([]);

    await reconcileDiscordConversationHistory({
      integrationId: address.integrationId,
      addresses: [address],
      adapter,
      history: { list },
      cursors,
      processor,
    });

    expect(accepted).toEqual(["423456789012345678", "523456789012345678"]);
    expect(cursors.cursor).toBe("523456789012345678");
    expect(list).toHaveBeenNthCalledWith(1, {
      channelId: address.conversationKey,
      after: "323456789012345678",
      limit: 100,
    });
    expect(receiveHistoryMessage).toHaveBeenCalledWith(expect.anything(), address.tenantKey);
  });

  it("establishes a latest-message baseline without replaying pre-install history", async () => {
    const cursors = new MemoryCursor();
    cursors.cursor = null;
    const receiveHistoryMessage = vi.fn();
    const adapter = { receiveHistoryMessage } as unknown as DiscordConversationAdapter;
    const processor = new DiscordConversationIngressProcessor({
      integrationId: address.integrationId,
      adapter,
      cursors,
      handleAccepted: async () => undefined,
    });

    await reconcileDiscordConversationHistory({
      integrationId: address.integrationId,
      addresses: [address],
      adapter,
      history: { list: async () => [historyMessage("623456789012345678")] },
      cursors,
      processor,
    });

    expect(cursors.cursor).toBe("623456789012345678");
    expect(receiveHistoryMessage).not.toHaveBeenCalled();
  });
});
