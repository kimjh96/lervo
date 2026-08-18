import { asRecord, eventTime, text } from "./normalization-utils.js";

export interface CapturedClaudeTurnResult {
  providerTurnId: string;
  content: string;
  producedAt: string;
}

export function captureClaudeTurnResult(input: {
  raw: unknown;
  providerSessionId: string;
  activeProviderTurnId: string | undefined;
  now: () => Date;
}): CapturedClaudeTurnResult | null {
  const message = asRecord(input.raw);
  if (
    message?.type !== "result" ||
    message.subtype !== "success" ||
    message.is_error !== false ||
    text(message.session_id) !== input.providerSessionId
  ) {
    return null;
  }
  const reported = text(message.user_message_uuid);
  const providerTurnId = reported ?? input.activeProviderTurnId;
  const content = text(message.result);
  if (
    providerTurnId === undefined ||
    content === undefined ||
    (reported !== undefined &&
      input.activeProviderTurnId !== undefined &&
      reported !== input.activeProviderTurnId)
  ) {
    return null;
  }
  return { providerTurnId, content, producedAt: eventTime(message, input.now) };
}
