import { asRecord, eventTime, text } from "./normalization-utils.js";
import type { ProviderModelIdentity } from "@lervo/schemas";

export interface CapturedClaudeTurnResult {
  providerTurnId: string;
  content: string;
  producedAt: string;
  modelIdentity: ProviderModelIdentity;
}

export function captureClaudeAssistantModel(
  raw: unknown,
  providerSessionId: string,
): string | null {
  const message = asRecord(raw);
  if (
    message?.type !== "assistant" ||
    text(message.session_id) !== providerSessionId ||
    (message.parent_tool_use_id !== null && message.parent_tool_use_id !== undefined)
  ) {
    return null;
  }
  return text(asRecord(message.message)?.model) ?? null;
}

export function captureClaudeTurnResult(input: {
  raw: unknown;
  providerSessionId: string;
  activeProviderTurnId: string | undefined;
  captureStructuredOutput: boolean;
  now: () => Date;
  requestedModel: string | null;
  answerModels: readonly string[];
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
  const observedModelIds = Object.keys(asRecord(message.modelUsage) ?? {}).sort();
  const answerModels = [...new Set(input.answerModels)].sort();
  const answerModel = answerModels.length === 1 ? answerModels[0]! : null;
  if (answerModel !== null && !observedModelIds.includes(answerModel)) {
    observedModelIds.push(answerModel);
    observedModelIds.sort();
  }
  return {
    providerTurnId,
    content,
    producedAt: eventTime(message, input.now),
    modelIdentity:
      answerModel === null
        ? {
            provider: "claude",
            requestedModel: input.requestedModel,
            answerModel: null,
            observedModelIds,
            answerModelEvidence: "unavailable",
            unavailableReason:
              answerModels.length === 0
                ? "provider_answer_model_unavailable"
                : "provider_answer_model_ambiguous",
          }
        : {
            provider: "claude",
            requestedModel: input.requestedModel,
            answerModel,
            observedModelIds,
            answerModelEvidence: "assistant_message",
            unavailableReason: null,
          },
  };
}
