/** ADR-0645: a cached-base delivery keeps its reason, the base's age, and its time only. */
export const terminalBaseDeliveryPayloadAllowlists = {
  "terminal.context.base_delivered": ["reason", "cacheAgeMilliseconds", "deliveredAt"],
} as const;
export const terminalBaseDeliveryPayloadSchemas = {
  "terminal.context.base_delivered": "terminalContextBaseDeliveredEventPayload",
} as const;
