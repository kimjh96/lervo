import { ConversationPlatformError } from "./types.js";

export function parseBoundedJson(body: Uint8Array, maximumBytes = 256 * 1024): unknown {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 4 * 1024 * 1024 ||
    body.byteLength < 1 ||
    body.byteLength > maximumBytes
  ) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "The platform payload size is outside the allowed range.",
    );
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch (error) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "The platform payload is not valid UTF-8 JSON.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConversationPlatformError(
      "invalid_platform_payload",
      "A platform payload object is required.",
    );
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, label: string, maximumLength = 512): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new ConversationPlatformError("invalid_platform_payload", `${label} value is invalid.`);
  }
  return value;
}
