import type {
  DiscordConversationAdapter,
  DiscordHistoryPort,
  DiscordIngressResult,
} from "@lervo/adapter-discord";
import type { ConversationPlatformIngressCursorPort } from "@lervo/conversation-platform";

export interface DiscordConversationAddress {
  tenantKey: string;
  conversationKey: string;
}

interface DiscordIngressProcessorOptions {
  integrationId: string;
  adapter: DiscordConversationAdapter;
  cursors: ConversationPlatformIngressCursorPort;
  handleAccepted(result: Extract<DiscordIngressResult, { status: "accepted" }>): Promise<void>;
}

export class DiscordConversationIngressProcessor {
  constructor(private readonly options: DiscordIngressProcessorOptions) {}

  async process(result: DiscordIngressResult, expectedCursor?: string | null): Promise<void> {
    if (result.status === "accepted") await this.options.handleAccepted(result);
    if (result.checkpoint === null) return;
    await this.options.cursors.advanceIngressCursor({
      platform: "discord",
      integrationId: this.options.integrationId,
      tenantKey: result.checkpoint.tenantKey,
      conversationKey: result.checkpoint.channelId,
      expectedCursor:
        expectedCursor === undefined
          ? await this.options.cursors.readIngressCursor({
              platform: "discord",
              integrationId: this.options.integrationId,
              tenantKey: result.checkpoint.tenantKey,
              conversationKey: result.checkpoint.channelId,
            })
          : expectedCursor,
      cursor: result.checkpoint.messageId,
    });
  }
}

function compareSnowflakes(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

export async function reconcileDiscordConversationHistory(input: {
  integrationId: string;
  addresses: readonly DiscordConversationAddress[];
  adapter: DiscordConversationAdapter;
  history: DiscordHistoryPort;
  cursors: ConversationPlatformIngressCursorPort;
  processor: DiscordConversationIngressProcessor;
  maximumMessages?: number;
}): Promise<void> {
  const maximumMessages = input.maximumMessages ?? 1_000;
  for (const address of input.addresses) {
    const coordinates = {
      platform: "discord",
      integrationId: input.integrationId,
      tenantKey: address.tenantKey,
      conversationKey: address.conversationKey,
    } as const;
    let cursor = await input.cursors.readIngressCursor(coordinates);
    if (cursor === null) {
      const latest = await input.history.list({
        channelId: address.conversationKey,
        after: null,
        limit: 1,
      });
      if (latest.length === 0) continue;
      await input.cursors.advanceIngressCursor({
        ...coordinates,
        expectedCursor: null,
        cursor: latest[0]!.messageId,
      });
      continue;
    }
    let processed = 0;
    while (true) {
      const messages = [
        ...(await input.history.list({
          channelId: address.conversationKey,
          after: cursor,
          limit: 100,
        })),
      ].sort((left, right) => compareSnowflakes(left.messageId, right.messageId));
      if (messages.length === 0) break;
      for (const message of messages) {
        if (++processed > maximumMessages) {
          throw new Error("Discord history exceeds the bounded startup reconciliation limit.");
        }
        const result = await input.adapter.receiveHistoryMessage(
          message,
          address.tenantKey === "dm" ? null : address.tenantKey,
        );
        if (
          result.checkpoint === null ||
          result.checkpoint.tenantKey !== address.tenantKey ||
          result.checkpoint.channelId !== address.conversationKey ||
          result.checkpoint.messageId !== message.messageId
        ) {
          throw new Error("Discord history message does not match its configured address.");
        }
        await input.processor.process(result, cursor);
        cursor = message.messageId;
      }
      if (messages.length < 100) break;
    }
  }
}
