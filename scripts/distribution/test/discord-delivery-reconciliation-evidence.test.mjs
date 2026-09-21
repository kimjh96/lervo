import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { test } from "vitest";

import { verifyDiscordDeliveryEvidence } from "../lib/discord-delivery-reconciliation-evidence.mjs";

const content = "A bounded verified response.";
const outbound = {
  deliveryRelation: "reply",
  content: {
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    byteCount: Buffer.byteLength(content),
  },
  createdAt: "2026-09-10T06:48:21.169Z",
};
const message = {
  id: "1547498951605751819",
  channel_id: "1546479355771883612",
  author: { id: "1547393266193006632" },
  content,
  message_reference: { message_id: "1547498867006767124" },
  timestamp: "2026-09-10T06:48:21.203000+00:00",
};
const coordinates = {
  messageId: message.id,
  channelId: message.channel_id,
  sourceExternalMessageId: message.message_reference.message_id,
  outbound,
  speaker: { kind: "bot", applicationId: message.author.id },
};

test("reconciles only an exact existing bot response", () => {
  assert.deepEqual(verifyDiscordDeliveryEvidence({ message, ...coordinates }), {
    externalMessageKey: message.id,
    deliveredAt: "2026-09-10T06:48:21.203Z",
    contentHash: outbound.content.contentHash,
  });
  assert.throws(
    () =>
      verifyDiscordDeliveryEvidence({
        message: { ...message, content: "Different content" },
        ...coordinates,
      }),
    /content or time/,
  );
  assert.throws(
    () =>
      verifyDiscordDeliveryEvidence({
        message: { ...message, author: { id: "other-bot" } },
        ...coordinates,
      }),
    /speaker/,
  );
  assert.throws(
    () =>
      verifyDiscordDeliveryEvidence({
        message: { ...message, message_reference: { message_id: "different-source" } },
        ...coordinates,
      }),
    /reply target/,
  );
});

test("does not infer a native reply for an installed webhook speaker", () => {
  assert.deepEqual(
    verifyDiscordDeliveryEvidence({
      message: {
        ...message,
        author: { id: "webhook-1" },
        webhook_id: "webhook-1",
        message_reference: undefined,
      },
      ...coordinates,
      speaker: { kind: "webhook", webhookId: "webhook-1" },
    }).externalMessageKey,
    message.id,
  );
});
