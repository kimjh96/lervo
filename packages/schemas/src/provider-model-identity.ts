import type { FromSchema } from "json-schema-to-ts";

import { providerSchema } from "./common.js";

const modelIdSchema = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$",
} as const;

const reasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

function modelIdentitySchema<const ModelId extends object>(modelIdSchema: ModelId) {
  return {
    type: "object",
    properties: {
      provider: providerSchema,
      requestedModel: { anyOf: [modelIdSchema, { type: "null" }] },
      answerModel: { anyOf: [modelIdSchema, { type: "null" }] },
      observedModelIds: {
        type: "array",
        items: modelIdSchema,
        uniqueItems: true,
        maxItems: 32,
      },
      answerModelEvidence: {
        type: "string",
        enum: ["thread_start", "response_object", "assistant_message", "unavailable"],
      },
      unavailableReason: { anyOf: [reasonCodeSchema, { type: "null" }] },
    },
    required: [
      "provider",
      "requestedModel",
      "answerModel",
      "observedModelIds",
      "answerModelEvidence",
      "unavailableReason",
    ],
    oneOf: [
      {
        properties: {
          answerModel: modelIdSchema,
          observedModelIds: { type: "array", items: modelIdSchema, minItems: 1, uniqueItems: true },
          answerModelEvidence: {
            type: "string",
            enum: ["thread_start", "response_object", "assistant_message"],
          },
          unavailableReason: { type: "null" },
        },
        required: ["answerModel", "observedModelIds", "answerModelEvidence", "unavailableReason"],
      },
      {
        properties: {
          answerModel: { type: "null" },
          answerModelEvidence: { const: "unavailable" },
          unavailableReason: reasonCodeSchema,
        },
        required: ["answerModel", "answerModelEvidence", "unavailableReason"],
      },
    ],
    additionalProperties: false,
  } as const;
}

export const providerModelIdentitySchema = modelIdentitySchema(modelIdSchema);

/**
 * A hosted provider's model names keep a bracketed tier, such as `claude-opus-5-5[1m]`, which is
 * priced differently. Only schema-11 hosted usage records use this pattern; every older payload
 * keeps the managed one, so older readers never see a bracket.
 */
export const hostedModelIdentitySchema = modelIdentitySchema({
  ...modelIdSchema,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/\\[\\]-]{0,127}$",
} as const);

export type ProviderModelIdentity = FromSchema<typeof providerModelIdentitySchema>;
export type HostedModelIdentity = FromSchema<typeof hostedModelIdentitySchema>;
