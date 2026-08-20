import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import {
  ConversationPlatformError,
  createPlatformConversationDescriptor,
  parseBoundedJson,
  storeConversationText,
} from "@lervo/conversation-platform";
import type {
  ConversationAdapterDescriptor,
  ConversationDeliveryReceipt,
  ConversationOutboundMessage,
} from "@lervo/schemas";

import type {
  DiscordConversationAdapterOptions,
  DiscordConversationAdapterPort,
  DiscordGatewayDispatch,
  DiscordIngressResult,
} from "./types.js";
import { deliverDiscordConversationMessage } from "./delivery.js";
import { parseDiscordGatewayPayload } from "./payload.js";

export class DiscordConversationAdapter implements DiscordConversationAdapterPort {
  readonly descriptor: ConversationAdapterDescriptor;
  private readonly guilds: Set<string>;
  private readonly now: () => Date;
  private readonly maximumPayloadBytes: number;

  constructor(private readonly options: DiscordConversationAdapterOptions) {
    if (
      !/^[0-9]{1,32}$/.test(options.applicationId) ||
      new Set(options.allowedGuildIds).size !== options.allowedGuildIds.length ||
      options.allowedGuildIds.some((guildId) => !/^[0-9]{1,32}$/.test(guildId)) ||
      (options.allowedGuildIds.length === 0 && !options.allowDirectMessages) ||
      (options.maximumGatewayPayloadBytes !== undefined && (
        !Number.isSafeInteger(options.maximumGatewayPayloadBytes) ||
        options.maximumGatewayPayloadBytes < 1 ||
        options.maximumGatewayPayloadBytes > 4 * 1024 * 1024
      ))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "Discord application, guild 또는 DM scope 구성이 유효하지 않습니다.",
      );
    }
    this.guilds = new Set(options.allowedGuildIds);
    this.now = options.now ?? (() => new Date());
    this.maximumPayloadBytes = options.maximumGatewayPayloadBytes ?? 256 * 1024;
    this.descriptor = createPlatformConversationDescriptor({
      integrationId: options.integrationId,
      platform: "discord",
      instanceIdentity: `${options.applicationId}:${[...options.allowedGuildIds].sort().join(",")}:${options.allowDirectMessages}`,
      supportedCapabilities: ["messages.receive", "messages.send", "threads"],
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    });
  }

  async receiveGatewayDispatch(input: DiscordGatewayDispatch): Promise<DiscordIngressResult> {
    if (!this.descriptor.capabilities.includes("messages.receive")) {
      throw new ConversationPlatformError("unsupported_platform_event", "Discord message 수신 기능이 꺼져 있습니다.");
    }
    const parsed = parseDiscordGatewayPayload(parseBoundedJson(input.body, this.maximumPayloadBytes));
    if (parsed.kind === "not_dispatch") {
      return { status: "ignored", reason: "not_a_dispatch" };
    }
    const verifiedAt = this.now().toISOString();
    let authentication;
    try {
      authentication = await this.options.gatewayAuthentication.verifyDispatch({
        sessionHandle: input.sessionHandle,
        applicationId: this.options.applicationId,
        sequence: parsed.sequence,
        eventName: parsed.eventName,
        verifiedAt,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "Discord Gateway session 인증을 확인하지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (!authentication.authenticated) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "Discord Gateway dispatch가 인증된 session에 속하지 않습니다.",
      );
    }
    if (parsed.kind === "ignored") return { status: "ignored", reason: parsed.reason };
    if (
      (parsed.guildId === null && !this.options.allowDirectMessages) ||
      (parsed.guildId !== null && !this.guilds.has(parsed.guildId))
    ) {
      throw new ConversationPlatformError("platform_authentication_failed", "Discord guild 또는 DM scope가 다릅니다.");
    }
    let identity;
    try {
      identity = await this.options.identity.mapInbound({
        platform: "discord",
        integrationId: this.descriptor.integrationId,
        tenantKey: parsed.guildId ?? "dm",
        conversationKey: parsed.channelId,
        threadKey: null,
        sourceMessageKey: parsed.messageId,
        replyToMessageKey: parsed.replyToMessageId,
        participantKey: parsed.participantKey,
        mentionedParticipantKeys: parsed.mentionedParticipantKeys,
        actorKindHint: parsed.actorKindHint,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "Discord 외부 식별자를 Lervo 대화 좌표로 바꾸지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const content = await storeConversationText({
      content: parsed.content,
      artifactStore: this.options.artifactStore,
    });
    const event = createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey(
          `${parsed.guildId ?? "dm"}:${parsed.messageId}`,
        ),
        target: {
          integrationId: this.descriptor.integrationId,
          projectId: identity.projectId,
          conversationId: identity.conversationId,
          threadId: identity.threadId,
        },
        kind: "message.created",
        actor: identity.actor,
        content,
        mentions: identity.mentions,
        replyToEventId: identity.replyToEventId,
        signalCode: null,
        automationDepth: identity.automationDepth,
        occurredAt: parsed.occurredAt,
      });
    try {
      await this.options.identity.recordInbound({
        platform: "discord",
        integrationId: this.descriptor.integrationId,
        tenantKey: parsed.guildId ?? "dm",
        conversationKey: parsed.channelId,
        externalMessageKey: parsed.messageId,
        eventId: event.eventId,
        automationDepth: event.automationDepth,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "Discord 메시지와 Lervo event 연결을 저장하지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    return {
      status: "accepted",
      event,
    };
  }

  async deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt> {
    if (!this.descriptor.capabilities.includes("messages.send")) {
      throw new ConversationPlatformError("platform_delivery_failed", "Discord message 전송 기능이 꺼져 있습니다.");
    }
    return deliverDiscordConversationMessage({
      descriptor: this.descriptor,
      message,
      allowedGuildIds: this.guilds,
      allowDirectMessages: this.options.allowDirectMessages,
      identity: this.options.identity,
      artifactStore: this.options.artifactStore,
      delivery: this.options.delivery,
    });
  }
}
