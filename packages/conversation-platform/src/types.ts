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

export type PlatformDeliveryReplayDecision =
  | { status: "reserved" }
  | { status: "delivered"; externalMessageKey: string; deliveredAt: string }
  | { status: "unknown" }
  | { status: "rejected" }
  | { status: "conflict" };

/**
 * Persists the send boundary before credentials are used. A `sending` record
 * left by a crash is reported as unknown and must not be sent again unless a
 * platform-specific reconciliation proves that doing so is safe.
 */
export interface ConversationPlatformDeliveryReplayPort {
  begin(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    outboundId: string;
    requestHash: string;
    attemptedAt: string;
  }): Promise<PlatformDeliveryReplayDecision>;
  complete(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    outboundId: string;
    requestHash: string;
    externalMessageKey: string;
    deliveredAt: string;
  }): Promise<void>;
  markUnknown(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    outboundId: string;
    requestHash: string;
  }): Promise<void>;
  markRejected(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    outboundId: string;
    requestHash: string;
  }): Promise<void>;
}

/**
 * Owns reversible platform identifiers outside the platform-neutral inbox.
 * recordInbound must durably bind the external address to the canonical event
 * before an accepted result is returned. recordOutbound has the same rule for
 * the delivery receipt. Both operations are idempotent and reject conflicting
 * bindings instead of replacing them.
 */
export interface ConversationPlatformIdentityPort {
  mapInbound(input: PlatformInboundIdentityRequest): Promise<PlatformInboundIdentity>;
  mapOutbound(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    target: ConversationTarget;
    actor: ConversationOutboundMessage["actor"];
  }): Promise<PlatformOutboundAddress>;
  recordInbound(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    tenantKey: string;
    conversationKey: string;
    externalMessageKey: string;
    eventId: string;
    automationDepth: number;
  }): Promise<void>;
  recordOutbound(input: {
    platform: ConversationPlatformKind;
    integrationId: string;
    tenantKey: string;
    conversationKey: string;
    outboundId: string;
    sourceEventId: string;
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
