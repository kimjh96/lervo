import { createHash } from "node:crypto";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function verifyDiscordDeliveryEvidence({
  message,
  messageId,
  channelId,
  sourceExternalMessageId,
  outbound,
  speaker,
}) {
  if (
    message?.id !== messageId ||
    message.channel_id !== channelId ||
    typeof message.content !== "string" ||
    !Number.isFinite(Date.parse(message.timestamp))
  ) {
    throw new Error("Discord delivery coordinates are not verified.");
  }
  if (
    (speaker.kind === "bot" &&
      (message.author?.id !== speaker.applicationId || message.webhook_id != null)) ||
    (speaker.kind === "webhook" && message.webhook_id !== speaker.webhookId)
  ) {
    throw new Error("Discord delivery speaker is not verified.");
  }
  const relation = outbound.deliveryRelation ?? "standalone";
  const actualReply = message.message_reference?.message_id ?? null;
  if (
    (speaker.kind === "bot" &&
      ((relation === "reply" &&
        (sourceExternalMessageId === null || actualReply !== sourceExternalMessageId)) ||
        (relation === "standalone" && actualReply !== null))) ||
    (speaker.kind === "webhook" && actualReply !== null)
  ) {
    throw new Error("Discord delivery reply target is not verified.");
  }
  const contentHash = digest(message.content);
  if (
    contentHash !== outbound.content.contentHash ||
    Buffer.byteLength(message.content, "utf8") !== outbound.content.byteCount ||
    Date.parse(message.timestamp) < Date.parse(outbound.createdAt)
  ) {
    throw new Error("Discord delivery content or time is not verified.");
  }
  return {
    externalMessageKey: messageId,
    deliveredAt: new Date(message.timestamp).toISOString(),
    contentHash,
  };
}
