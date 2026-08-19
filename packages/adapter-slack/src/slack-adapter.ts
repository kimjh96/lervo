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

import { verifySlackRequest } from "./authentication.js";
import { deliverSlackConversationMessage } from "./delivery.js";
import { parseSlackIngress } from "./payload.js";
import type {
  SlackConversationAdapterOptions,
  SlackConversationAdapterPort,
  SlackIngressResult,
  SlackSignedHttpRequest,
} from "./types.js";

export class SlackConversationAdapter implements SlackConversationAdapterPort {
  readonly descriptor: ConversationAdapterDescriptor;
  private readonly teams: Set<string>;
  private readonly now: () => Date;
  private readonly maximumRequestBytes: number;

  constructor(private readonly options: SlackConversationAdapterOptions) {
    if (
      options.apiAppId.length < 1 || options.apiAppId.length > 128 ||
      options.allowedTeamIds.length < 1 || new Set(options.allowedTeamIds).size !== options.allowedTeamIds.length ||
      options.allowedTeamIds.some((teamId) => teamId.length < 1 || teamId.length > 128) ||
      options.signingSecret.length < 16 || options.signingSecret.length > 512 ||
      (options.maximumRequestBytes !== undefined && (
        !Number.isSafeInteger(options.maximumRequestBytes) || options.maximumRequestBytes < 1 ||
        options.maximumRequestBytes > 4 * 1024 * 1024
      ))
    ) {
      throw new ConversationPlatformError(
        "invalid_platform_configuration",
        "Slack app, team 또는 signing secret 구성이 유효하지 않습니다.",
      );
    }
    this.teams = new Set(options.allowedTeamIds);
    this.now = options.now ?? (() => new Date());
    this.maximumRequestBytes = options.maximumRequestBytes ?? 256 * 1024;
    this.descriptor = createPlatformConversationDescriptor({
      integrationId: options.integrationId,
      platform: "slack",
      instanceIdentity: `${options.apiAppId}:${[...options.allowedTeamIds].sort().join(",")}`,
      supportedCapabilities: ["messages.receive", "messages.send", "threads"],
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
    });
  }

  async receive(request: SlackSignedHttpRequest): Promise<SlackIngressResult> {
    if (!this.descriptor.capabilities.includes("messages.receive")) {
      throw new ConversationPlatformError("unsupported_platform_event", "Slack message 수신 기능이 꺼져 있습니다.");
    }
    if (request.body.byteLength < 1 || request.body.byteLength > this.maximumRequestBytes) {
      throw new ConversationPlatformError("invalid_platform_payload", "Slack 요청 크기가 허용 범위를 벗어났습니다.");
    }
    verifySlackRequest({
      headers: request.headers,
      body: request.body,
      signingSecret: this.options.signingSecret,
      now: this.now(),
    });
    const parsed = parseSlackIngress({
      value: parseBoundedJson(request.body, this.maximumRequestBytes),
      apiAppId: this.options.apiAppId,
      allowedTeamIds: this.teams,
    });
    if (parsed.kind === "challenge") {
      return { status: "challenge", challenge: parsed.challenge };
    }
    if (parsed.kind === "ignored") return { status: "ignored", reason: parsed.reason };
    let identity;
    try {
      identity = await this.options.identity.mapInbound({
        platform: "slack",
        integrationId: this.descriptor.integrationId,
        tenantKey: parsed.teamId,
        conversationKey: parsed.channelId,
        threadKey: parsed.threadTs === parsed.messageTs ? null : parsed.threadTs,
        sourceMessageKey: parsed.messageTs,
        replyToMessageKey: parsed.threadTs !== null && parsed.threadTs !== parsed.messageTs
          ? parsed.threadTs
          : null,
        participantKey: parsed.participantKey,
        mentionedParticipantKeys: parsed.mentionedParticipantKeys,
        actorKindHint: parsed.actorKindHint,
      });
    } catch (error) {
      throw new ConversationPlatformError(
        "identity_mapping_failed",
        "Slack 외부 식별자를 Lervo 대화 좌표로 바꾸지 못했습니다.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const content = await storeConversationText({
      content: parsed.text,
      artifactStore: this.options.artifactStore,
    });
    return {
      status: "accepted",
      event: createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey(`${parsed.teamId}:${parsed.eventId}`),
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
      }),
    };
  }

  async deliver(message: ConversationOutboundMessage): Promise<ConversationDeliveryReceipt> {
    if (!this.descriptor.capabilities.includes("messages.send")) {
      throw new ConversationPlatformError("platform_delivery_failed", "Slack message 전송 기능이 꺼져 있습니다.");
    }
    return deliverSlackConversationMessage({
      descriptor: this.descriptor,
      message,
      allowedTeamIds: this.teams,
      identity: this.options.identity,
      artifactStore: this.options.artifactStore,
      delivery: this.options.delivery,
    });
  }
}
