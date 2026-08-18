import { asRecord, eventTime, providerThreadId, text } from "./normalization-utils.js";

export interface CapturedCodexTurnResult {
  providerTurnId: string;
  content: string;
  producedAt: string;
}

export function captureCodexTurnResult(input: {
  raw: unknown;
  providerSessionId: string;
  now: () => Date;
}): CapturedCodexTurnResult | null {
  const message = asRecord(input.raw);
  const method = text(message?.method);
  const params = asRecord(message?.params);
  if (message === undefined || method !== "item/completed" || params === undefined) return null;
  if (providerThreadId(method, params) !== input.providerSessionId) return null;
  const item = asRecord(params.item);
  const providerTurnId = text(params.turnId);
  const content = item?.type === "agentMessage" ? text(item.text) : undefined;
  if (providerTurnId === undefined || content === undefined) return null;
  return {
    providerTurnId,
    content,
    producedAt: eventTime(message, params, input.now),
  };
}
