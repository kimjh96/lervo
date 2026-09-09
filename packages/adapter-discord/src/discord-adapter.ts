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
  DiscordHistoryMessage,
  DiscordIngressResult,
} from "./types.js";
import { deliverDiscordConversationMessage } from "./delivery.js";
import {
  parseDiscordGatewayPayload,
  parseDiscordMessagePayload,
  type ParsedDiscordMessage,
} from "./payload.js";

export class DiscordConversationAdapter implements DiscordConversationAdapterPort {
  readonly descriptor: ConversationAdapterDescriptor;
  private readonly guilds: Set<string>;
  private readonly now: () => Date;
  private readonly maximumPayloadBytes: number;
  private readonly ignoredParticipantKeys: ReadonlySet<string>;

  constructor(private readonly options: DiscordConversationAdapterOptions) {
    if (
      !/^[0-9]{1,32}$/.test(options.applicationId) ||
      new Set(options.allowedGuildIds).size !== options.allowedGuildIds.length ||
      options.allowedGuildIds.some((guildId) => !/^[0-9]{1,32}$/.test(guildId)) ||
      (options.allowedGuildIds.length === 0 && !options.allowDirectMessages) ||
      (options.maximumGatewayPayloadBytes !== undefined &&
        (!Number.isSafeInteger(options.maximumGatewayPayloadBytes) ||
          options.maximumGatewayPayloadBytes < 1 ||
          options.maximumGatewayPayloadBytes > 4 * 1024 * 1024)) ||
      (options.deliveryIdentity !== undefined &&
        (options.deliveryIdentity.length < 1 || options.deliveryIdentity.length > 512)) ||
      (options.ignoredParticipantKeys !== undefined &&
        (new Set(options.ignoredParticipantKeys).size !== options.ignoredParticipantKeys.length ||
          options.ignoredParticipantKeys.some(
            (key) => !/^(?:bot|webhook):[0-9]{1,32}$/u.test(key),
          )))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "The Discord application, guild, or DM scope configuration is invalid.",
      );
    }
    this.guilds = new Set(options.allowedGuildIds);
    this.now = options.now ?? (() => new Date());
    this.maximumPayloadBytes = options.maximumGatewayPayloadBytes ?? 256 * 1024;
    this.ignoredParticipantKeys = new Set(
      options.ignoredParticipantKeys ?? [`bot:${options.applicationId}`],
    );
    this.descriptor = createPlatformConversationDescriptor({
      integrationId: options.integrationId,
      platform: "discord",
      instanceIdentity: `${options.applicationId}:${options.deliveryIdentity ?? options.applicationId}:${[...options.allowedGuildIds].sort().join(",")}:${options.allowDirectMessages}`,
      supportedCapabilities: [
        "messages.receive",
        "messages.send",
        "threads",
        ...(options.typing === undefined ? [] : (["typing"] as const)),
      ],
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    });
  }

  async receiveGatewayDispatch(input: DiscordGatewayDispatch): Promise<DiscordIngressResult> {
    if (!this.descriptor.capabilities.includes("messages.receive")) {
      throw new ConversationPlatformError(
        "unsupported_platform_event",
        "Discord message reception is disabled.",
      );
    }
    const parsed = parseDiscordGatewayPayload(
      parseBoundedJson(input.body, this.maximumPayloadBytes),
    );
    if (parsed.kind === "not_dispatch") {
      return { status: "ignored", reason: "not_a_dispatch", checkpoint: null };
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
        "The Discord Gateway session authentication could not be verified.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (!authentication.authenticated) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "The Discord Gateway dispatch does not belong to the authenticated session.",
      );
    }
    if (parsed.kind === "ignored") {
      return { status: "ignored", reason: parsed.reason, checkpoint: null };
    }
    return this.receiveAuthenticatedMessage(parsed);
  }

  async receiveHistoryMessage(
    input: DiscordHistoryMessage,
    expectedGuildId: string | null,
  ): Promise<DiscordIngressResult> {
    if (!this.descriptor.capabilities.includes("messages.receive")) {
      throw new ConversationPlatformError(
        "unsupported_platform_event",
        "Discord message reception is disabled.",
      );
    }
    const parsed = parseDiscordMessagePayload(
      parseBoundedJson(input.body, this.maximumPayloadBytes),
    );
    if (parsed.guildId !== null && parsed.guildId !== expectedGuildId) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "The Discord history message guild does not match its configured channel.",
      );
    }
    return this.receiveAuthenticatedMessage({ ...parsed, guildId: expectedGuildId });
  }

  private async receiveAuthenticatedMessage(
    parsed: ParsedDiscordMessage,
  ): Promise<DiscordIngressResult> {
    if (
      (parsed.guildId === null && !this.options.allowDirectMessages) ||
      (parsed.guildId !== null && !this.guilds.has(parsed.guildId))
    ) {
      throw new ConversationPlatformError(
        "platform_authentication_failed",
        "The Discord guild or DM scope does not match.",
      );
    }
    const checkpoint = {
      tenantKey: parsed.guildId ?? "dm",
      channelId: parsed.channelId,
      messageId: parsed.messageId,
    };
    if (this.ignoredParticipantKeys.has(parsed.participantKey)) {
      return { status: "ignored", reason: "own_participant_message", checkpoint };
    }
    let address: { conversationKey: string; threadKey: string | null };
    try {
      address =
        this.options.conversationAddress === undefined
          ? { conversationKey: parsed.channelId, threadKey: null }
          : await this.options.conversationAddress.resolve({
              guildId: parsed.guildId,
              channelId: parsed.channelId,
            });
    } catch (error) {
      if (error instanceof ConversationPlatformError) throw error;
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The Discord conversation address could not be resolved.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    let identity;
    try {
      identity = await this.options.identity.mapInbound({
        platform: "discord",
        integrationId: this.descriptor.integrationId,
        tenantKey: parsed.guildId ?? "dm",
        conversationKey: address.conversationKey,
        threadKey: address.threadKey,
        sourceMessageKey: parsed.messageId,
        replyToMessageKey: parsed.replyToMessageId,
        participantKey: parsed.participantKey,
        mentionedParticipantKeys: parsed.mentionedParticipantKeys,
        actorKindHint: parsed.actorKindHint,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "Discord external identifiers could not be mapped to Lervo conversation coordinates.",
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
        conversationKey: address.conversationKey,
        externalMessageKey: parsed.messageId,
        eventId: event.eventId,
        automationDepth: event.automationDepth,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "The link between the Discord message and Lervo event could not be saved.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    return {
      status: "accepted",
      event,
      checkpoint,
      responseActivity:
        this.options.typing === undefined
          ? null
          : { start: () => this.options.typing!.start({ channelId: parsed.channelId }) },
    };
  }

  async deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt> {
    if (!this.descriptor.capabilities.includes("messages.send")) {
      throw new ConversationPlatformError(
        "platform_delivery_failed",
        "Discord message delivery is disabled.",
      );
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
