import { randomUUID } from "node:crypto";

import { CodexAdapterError } from "./types.js";

export function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function requiredResponseText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has no output text.",
    );
  }
  return value;
}

export function codexResponsesOutputText(response: Record<string, unknown>): {
  itemId: string;
  text: string;
} {
  if (!Array.isArray(response.output) || response.output.length === 0) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has no output items.",
    );
  }
  const messages = response.output.map(responseRecord);
  if (messages.some((item) => item?.type !== "message")) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The no-tool Codex Responses result contained a non-message output item.",
    );
  }
  const parts = messages.flatMap((message) =>
    Array.isArray(message?.content) ? message.content.map(responseRecord) : [],
  );
  if (parts.length === 0 || parts.some((part) => part?.type !== "output_text")) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The no-tool Codex Responses result contained unsupported message content.",
    );
  }
  return {
    itemId:
      typeof messages[0]?.id === "string" && messages[0].id.length > 0
        ? messages[0].id
        : `msg_${randomUUID().replaceAll("-", "")}`,
    text: requiredResponseText(parts.map((part) => part?.text).join("")),
  };
}

export function codexResponsesUsage(response: Record<string, unknown>) {
  const raw = responseRecord(response.usage);
  const inputDetails = responseRecord(raw?.input_tokens_details);
  const outputDetails = responseRecord(raw?.output_tokens_details);
  const values = {
    inputTokens: nonNegativeInteger(raw?.input_tokens),
    cachedInputTokens: nonNegativeInteger(inputDetails?.cached_tokens ?? 0),
    outputTokens: nonNegativeInteger(raw?.output_tokens),
    reasoningOutputTokens: nonNegativeInteger(outputDetails?.reasoning_tokens ?? 0),
    totalTokens: nonNegativeInteger(raw?.total_tokens),
  };
  if (Object.values(values).some((value) => value === null)) {
    throw new CodexAdapterError(
      "provider_protocol_failed",
      "The Codex Responses result has invalid usage totals.",
    );
  }
  return values as Record<keyof typeof values, number>;
}
