import type { ConversationPlatformKind } from "@lervo/conversation-platform";
import type { ConversationInboundEvent, ConversationTarget } from "@lervo/schemas";

export interface ConversationPlatformConversationBinding {
  platform: ConversationPlatformKind;
  integrationId: string;
  tenantKey: string;
  conversationKey: string;
  projectId: string;
  conversationId: string;
}

export interface ConversationPlatformParticipantBinding {
  platform: ConversationPlatformKind;
  integrationId: string;
  tenantKey: string;
  participantKey: string;
  actor: ConversationInboundEvent["actor"];
  startsAutomationChain?: boolean;
}

export interface ConversationPlatformThreadBinding {
  platform: ConversationPlatformKind;
  integrationId: string;
  tenantKey: string;
  conversationKey: string;
  threadKey: string;
  threadId: Exclude<ConversationTarget["threadId"], null>;
}

export interface SQLiteConversationPlatformStoreOptions {
  path: string;
  conversations: readonly ConversationPlatformConversationBinding[];
  participants: readonly ConversationPlatformParticipantBinding[];
  threads?: readonly ConversationPlatformThreadBinding[];
}
