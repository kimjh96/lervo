import type { FromSchema } from "json-schema-to-ts";

import {
  deliberationPolicyIdSchema,
  providerSchema,
  roleIdSchema,
  schemaVersionSchema,
  verificationSuiteIdSchema,
} from "./common.js";
import { deliberationResponsibilities } from "./deliberation-policy.js";

export const deliberationWorkflowSourceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-workflow-source.schema.json",
  title: "Lervo user-authored deliberation workflow source",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    policyId: deliberationPolicyIdSchema,
    maxRounds: { type: "integer", minimum: 1, maximum: 5 },
    requiredVerificationSuiteIds: {
      type: "array",
      items: verificationSuiteIdSchema,
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
    },
    participants: {
      type: "array",
      minItems: 3,
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          roleId: roleIdSchema,
          name: { type: "string", minLength: 1, maxLength: 100 },
          description: { type: "string", minLength: 1, maxLength: 1000 },
          provider: providerSchema,
          responsibilities: {
            type: "array",
            items: { type: "string", enum: deliberationResponsibilities },
            minItems: 1,
            maxItems: 2,
            uniqueItems: true,
          },
        },
        required: ["roleId", "name", "description", "provider", "responsibilities"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "schemaVersion",
    "policyId",
    "maxRounds",
    "requiredVerificationSuiteIds",
    "participants",
  ],
  additionalProperties: false,
} as const;

export type DeliberationWorkflowSource = FromSchema<typeof deliberationWorkflowSourceSchema>;
