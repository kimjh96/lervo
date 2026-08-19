import { ConversationPlatformError } from "./types.js";

export function parseBoundedJson(
  body: Uint8Array,
  maximumBytes = 256 * 1024,
): unknown {
  if (
    !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024 ||
    body.byteLength < 1 || body.byteLength > maximumBytes
  ) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "Platform payload 크기가 허용 범위를 벗어났습니다.",
    );
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "Platform payload가 유효한 UTF-8 JSON이 아닙니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "Platform payload 객체가 필요합니다.",
    );
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  value: unknown,
  label: string,
  maximumLength = 512,
): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      `${label} 값이 유효하지 않습니다.`,
    );
  }
  return value;
}
