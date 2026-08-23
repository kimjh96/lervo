import { createHmac, timingSafeEqual } from "node:crypto";

import { ConversationPlatformError } from "@lervo/conversation-platform";

function singleHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string {
  const values = Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === name)
    .flatMap(([, value]) => typeof value === "string" ? [value] : value ?? []);
  if (values.length !== 1 || values[0]!.length > 256) {
    throw new ConversationPlatformError(
      "platform_authentication_failed",
      "A Slack authentication header is missing or duplicated.",
    );
  }
  return values[0]!;
}

export function verifySlackRequest(input: {
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Uint8Array;
  signingSecret: string;
  now: Date;
}): void {
  const timestamp = singleHeader(input.headers, "x-slack-request-timestamp");
  const signature = singleHeader(input.headers, "x-slack-signature");
  if (!/^[0-9]{1,12}$/.test(timestamp) || !/^v0=[a-f0-9]{64}$/.test(signature)) {
    throw new ConversationPlatformError(
      "platform_authentication_failed",
      "The Slack signature format is invalid.",
    );
  }
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  const requestSeconds = Number(timestamp);
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - requestSeconds) > 300) {
    throw new ConversationPlatformError(
      "platform_authentication_failed",
      "The Slack request time falls outside the allowed five-minute window.",
    );
  }
  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${timestamp}:`)
    .update(input.body)
    .digest("hex")}`;
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    actualBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new ConversationPlatformError(
      "platform_authentication_failed",
      "The Slack request signature does not match.",
    );
  }
}
