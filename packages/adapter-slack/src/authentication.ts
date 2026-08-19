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
      "Slack 인증 header가 없거나 중복되었습니다.",
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
      "Slack 서명 형식이 유효하지 않습니다.",
    );
  }
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  const requestSeconds = Number(timestamp);
  if (!Number.isFinite(nowSeconds) || Math.abs(nowSeconds - requestSeconds) > 300) {
    throw new ConversationPlatformError(
      "platform_authentication_failed",
      "Slack 요청 시각이 허용된 5분 범위를 벗어났습니다.",
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
      "Slack 요청 서명이 일치하지 않습니다.",
    );
  }
}
