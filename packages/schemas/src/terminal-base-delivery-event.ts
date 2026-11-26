import type { FromSchema } from "json-schema-to-ts";
import { timestampSchema } from "./common.js";

/**
 * Schema 14 (ADR-0645): a prompt the context server could not take, answered by the launcher from
 * the checkout's cached base. The record says only why and how old the base was; no prompt, path,
 * or session identity is kept. Such a turn records no prepared context.
 */
export const terminalBaseDeliveryEventTypes = ["terminal.context.base_delivered"] as const;

/** Why the server did not take the prompt; other offer outcomes run the hook in its own process. */
export const terminalBaseDeliveryReasons = ["no_server", "unreachable", "declined_busy"] as const;

export const terminalContextBaseDeliveredEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-context-base-delivered-event-payload.schema.json",
  type: "object",
  properties: {
    reason: { type: "string", enum: terminalBaseDeliveryReasons },
    /** How old the cached base was when the launcher printed it; never older than 30 minutes. */
    cacheAgeMilliseconds: { type: "integer", minimum: 0, maximum: 1_800_000 },
    deliveredAt: timestampSchema,
  },
  required: ["reason", "cacheAgeMilliseconds", "deliveredAt"],
  additionalProperties: false,
} as const;

export type TerminalContextBaseDeliveredEventPayload = FromSchema<
  typeof terminalContextBaseDeliveredEventPayloadSchema
>;
