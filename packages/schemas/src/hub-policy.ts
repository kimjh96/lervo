import type { FromSchema } from "json-schema-to-ts";

import {
  capabilityNameSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./common.js";
import { policyRuleSchema } from "./policy.js";

export const hubPolicySnapshotWriteRequestSchema = {
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    rules: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: policyRuleSchema,
    },
    expiresAt: timestampSchema,
  },
  required: ["schemaVersion", "rules", "expiresAt"],
  additionalProperties: false,
} as const;

export const hubPolicyApprovalWriteRequestSchema = {
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    commandId: { type: "string", pattern: "^rcm_[a-f0-9]{64}$" },
    capability: capabilityNameSchema,
    repositoryPaths: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: repositoryRelativePathSchema,
    },
    expiresAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "commandId",
    "capability",
    "repositoryPaths",
    "expiresAt",
  ],
  additionalProperties: false,
} as const;

export const hubPolicyRevocationWriteRequestSchema = {
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approvalId: { type: "string", pattern: "^apr_[a-f0-9]{64}$" },
    reasonCode: {
      type: "string",
      enum: ["cancelled", "superseded", "security_policy_changed"],
    },
  },
  required: ["schemaVersion", "approvalId", "reasonCode"],
  additionalProperties: false,
} as const;

export type HubPolicySnapshotWriteRequest = FromSchema<
  typeof hubPolicySnapshotWriteRequestSchema
>;
export type HubPolicyApprovalWriteRequest = FromSchema<
  typeof hubPolicyApprovalWriteRequestSchema
>;
export type HubPolicyRevocationWriteRequest = FromSchema<
  typeof hubPolicyRevocationWriteRequestSchema
>;
