import { ContextDeliveryError, type ContextDeliveryPolicy } from "./types.js";

const defaultInlineByteLimit = 64 * 1024;

export function createInlineThresholdPolicy(
  inlineByteLimit = defaultInlineByteLimit,
): ContextDeliveryPolicy {
  if (!Number.isSafeInteger(inlineByteLimit) || inlineByteLimit < 0) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "inlineByteLimit must be a safe integer of at least 0.",
    );
  }
  return (candidate) =>
    candidate.inlineContentAvailable && candidate.byteCount <= inlineByteLimit ? "inline" : "cas";
}

export const inlineContextDelivery: ContextDeliveryPolicy = () => "inline";
export const casContextDelivery: ContextDeliveryPolicy = () => "cas";
