import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

export const agentLivenessObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/agent-liveness-observed-event-payload.schema.json",
  type: "object",
  properties: {
    agentId: { type: "string", pattern: "^agt_[a-f0-9]{24}$" },
    agentRevision: { type: "integer", minimum: 1 },
    reportingProvider: { type: "string", enum: ["codex", "claude"] },
    providerSessionDigest: sha256Schema,
    observedAt: timestampSchema,
  },
  required: [
    "agentId",
    "agentRevision",
    "reportingProvider",
    "providerSessionDigest",
    "observedAt",
  ],
  additionalProperties: false,
} as const;

export type AgentLivenessObservedEventPayload = FromSchema<
  typeof agentLivenessObservedEventPayloadSchema
>;
