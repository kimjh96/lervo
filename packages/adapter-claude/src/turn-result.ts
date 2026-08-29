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
  captureStructuredOutput: boolean;
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
  let content = text(message.result);
  if (input.captureStructuredOutput) {
    try {
      content =
        message.structured_output === undefined
          ? undefined
          : JSON.stringify(message.structured_output);
    } catch {
      content = undefined;
    }
  }
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
