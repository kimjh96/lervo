import { createHash } from "node:crypto";

import { assertConversationDeliveryReceipt } from "@lervo/conversation-contract";
import type {
  ConversationAdapterDescriptor,
  ConversationDeliveryReceipt,
  ConversationOutboundMessage,
} from "@lervo/schemas";

import { ConversationPlatformError } from "./types.js";

export function createPlatformDeliveryReceipt(input: {
  descriptor: ConversationAdapterDescriptor;
  message: ConversationOutboundMessage;
  externalMessageKey: string;
  deliveredAt: string;
}): ConversationDeliveryReceipt {
  if (
    input.externalMessageKey.length < 1 || input.externalMessageKey.length > 512 ||
    !Number.isFinite(Date.parse(input.deliveredAt)) ||
    Date.parse(input.deliveredAt) < Date.parse(input.message.createdAt)
  ) {
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "Platform delivery 결과 좌표나 시각이 유효하지 않습니다.",
    );
  }
  const receipt: ConversationDeliveryReceipt = {
    schemaVersion: 1,
    outboundId: input.message.outboundId,
    integrationId: input.descriptor.integrationId,
    deliveryKeyHash: `sha256:${createHash("sha256")
      .update(input.externalMessageKey, "utf8").digest("hex")}`,
    deliveredAt: input.deliveredAt,
  };
  assertConversationDeliveryReceipt({
    receipt,
    outbound: input.message,
    descriptor: input.descriptor,
  });
  return receipt;
}
