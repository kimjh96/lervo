import type {
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationTarget,
} from "@lervo/schemas";

export type ConversationPlatformKind = "slack" | "discord";

export interface PlatformInboundIdentityRequest {
  platform: ConversationPlatformKind;
  integrationId: string;
  tenantKey: string;
  conversationKey: string;
  threadKey: string | null;
  sourceMessageKey: string;
  replyToMessageKey: string | null;
  participantKey: string;
  mentionedParticipantKeys: readonly string[];
  actorKindHint: "human" | "agent" | "system";
}

export interface PlatformInboundIdentity {
  projectId: string;
  conversationId: string;
  threadId: string | null;
  actor: ConversationInboundEvent["actor"];
  mentions: ConversationInboundEvent["mentions"];
  replyToEventId: string | null;
  automationDepth: number;
}

export interface PlatformOutboundAddress {
  tenantKey: string;
  conversationKey: string;
  threadKey: string | null;
  replyToMessageKey: string | null;
}

/**
 * Owns reversible platform identifiers outside the platform-neutral inbox.
 * recordOutbound must durably commit the external correlation before it
 * resolves and must be idempotent by outboundId.
 */
export interface ConversationPlatformIdentityPort {
  mapInbound(input: PlatformInboundIdentityRequest): Promise<PlatformInboundIdentity>;
  mapOutbound(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    target: ConversationTarget;
    actor: ConversationOutboundMessage["actor"];
  }): Promise<PlatformOutboundAddress>;
  recordOutbound(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    outboundId: string;
    externalMessageKey: string;
    automationDepth: number;
  }): Promise<void>;
}

export type PlatformIngressResult =
  | { status: "accepted"; event: ConversationInboundEvent }
  | { status: "ignored"; reason: string };

export class ConversationPlatformError extends Error {
  constructor(
    readonly code:
      | "artifact_storage_failed"
      | "identity_mapping_failed"
      | "invalid_platform_configuration"
      | "invalid_platform_payload"
      | "platform_authentication_failed"
      | "platform_delivery_failed"
      | "unsupported_platform_event",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationPlatformError";
  }
}
