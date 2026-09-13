import {
  validateSchema,
  type EventEnvelope,
  type ResourceUsageRecordedEventPayload,
} from "@lervo/schemas";

export type ReadResourceUsagePayload = Omit<ResourceUsageRecordedEventPayload, "modelIdentity"> & {
  modelIdentity?: ResourceUsageRecordedEventPayload["modelIdentity"];
};

/** Reads historical counters without adding model evidence to the canonical payload. */
export function readResourceUsageEventPayload(
  event: EventEnvelope,
): ReadResourceUsagePayload | null {
  if (event.type !== "resource.usage.recorded" || ![2, 3].includes(event.schemaVersion))
    return null;
  const legacy =
    event.schemaVersion === 2 &&
    event.actor.kind === "provider" &&
    !Object.hasOwn(event.payload, "modelIdentity");
  const candidate = legacy
    ? {
        ...event.payload,
        modelIdentity: {
          provider: event.actor.provider,
          requestedModel: null,
          answerModel: null,
          observedModelIds: [],
          answerModelEvidence: "unavailable",
          unavailableReason: "legacy_unobserved",
        },
      }
    : event.payload;
  if (!validateSchema("resourceUsageRecordedEventPayload", candidate).valid) return null;
  const payload = event.payload as ReadResourceUsagePayload;
  const usage = payload.usage;
  if (
    usage !== null &&
    (usage.cachedInputTokens > usage.inputTokens ||
      usage.reasoningOutputTokens > usage.outputTokens ||
      usage.totalTokens !== usage.inputTokens + usage.outputTokens)
  )
    return null;
  return payload;
}
