import type {
  ConversationAdapterCapability,
  ConversationContentReference,
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationTarget,
} from "@lervo/schemas";

export interface NativeChatInboundEnvelope {
  sourceEventKey: string;
  target: Omit<ConversationTarget, "integrationId">;
  kind: ConversationInboundEvent["kind"];
  actor: ConversationInboundEvent["actor"];
  content: ConversationContentReference;
  mentions?: ConversationInboundEvent["mentions"];
  replyToEventId?: string | null;
  signalCode?: string | null;
  audienceParticipation?: ConversationInboundEvent["audienceParticipation"];
  automationDepth?: number;
  occurredAt: string;
}

export interface NativeChatDeliveryResult {
  deliveryKey: string;
  deliveredAt: string;
}

export interface NativeChatDeliveryPort {
  send(message: ConversationOutboundMessage): Promise<NativeChatDeliveryResult>;
}

export interface NativeChatAdapterOptions {
  integrationId: string;
  instanceIdentity: string;
  delivery: NativeChatDeliveryPort;
  capabilities?: readonly ConversationAdapterCapability[];
}
