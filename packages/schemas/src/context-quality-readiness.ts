import type { FromSchema } from "json-schema-to-ts";

export const contextQualityBindingNames = [
  "normalized_task",
  "authority_scope",
  "applicable_policy",
  "source_snapshot",
  "retrieval_plan",
  "resource_profile",
  "implementation_builds",
  "execution_capabilities",
] as const;

/** Unbound legacy observations cannot produce a normalized quality request. */
export const contextQualityReadinessSchema = {
  type: "object",
  properties: {
    status: { const: "unavailable" },
    reasonCode: { const: "context_binding_unavailable" },
    missingBindings: {
      type: "array",
      minItems: 1,
      maxItems: contextQualityBindingNames.length,
      uniqueItems: true,
      items: { enum: contextQualityBindingNames },
    },
  },
  required: ["status", "reasonCode", "missingBindings"],
  additionalProperties: false,
} as const;

export type ContextQualityReadiness = FromSchema<typeof contextQualityReadinessSchema>;
