import { asRecord, eventTime, providerThreadId, text } from "./normalization-utils.js";
import type { ProviderModelIdentity } from "@lervo/schemas";

export interface CapturedCodexTurnResult {
  providerTurnId: string;
  content: string;
  producedAt: string;
  modelIdentity: ProviderModelIdentity;
}

export function captureCodexTurnResult(input: {
  raw: unknown;
  providerSessionId: string;
  now: () => Date;
  requestedModel: string | null;
  sessionObservedModel: string | null;
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
  const responseModel = item?.type === "agentMessage" ? text(item.model) : undefined;
  const answerModel = responseModel ?? input.sessionObservedModel;
  return {
    providerTurnId,
    content,
    producedAt: eventTime(message, params, input.now),
    modelIdentity:
      answerModel === null
        ? {
            provider: "codex",
            requestedModel: input.requestedModel,
            answerModel: null,
            observedModelIds: [],
            answerModelEvidence: "unavailable",
            unavailableReason: "provider_model_unavailable",
          }
        : {
            provider: "codex",
            requestedModel: input.requestedModel,
            answerModel,
            observedModelIds: [answerModel],
            answerModelEvidence: responseModel === undefined ? "thread_start" : "response_object",
            unavailableReason: null,
          },
  };
}
