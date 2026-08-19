import type { FromSchema } from "json-schema-to-ts";

import {
  capabilityNameSchema,
  roleIdSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { remoteCommandTargetSchema } from "./remote-command.js";

const keyIdSchema = {
  type: "string",
  pattern: "^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$",
} as const;

const signatureSchema = {
  type: "object",
  properties: {
    algorithm: { type: "string", const: "ed25519" },
    keyId: keyIdSchema,
    value: { type: "string", pattern: "^[A-Za-z0-9_-]{86}$" },
  },
  required: ["algorithm", "keyId", "value"],
  additionalProperties: false,
} as const;

export const policyRuleSchema = {
  type: "object",
  properties: {
    ruleId: {
      type: "string",
      pattern: "^polr_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$",
    },
    roleId: roleIdSchema,
    risk: { type: "string", enum: ["low", "medium", "high"] },
    capability: capabilityNameSchema,
    decision: {
      type: "string",
      enum: ["allow", "deny", "require_approval"],
    },
  },
  required: ["ruleId", "roleId", "risk", "capability", "decision"],
  additionalProperties: false,
} as const;

export const policySnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/policy-snapshot.schema.json",
  title: "Lervo project policy snapshot",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    snapshotId: { type: "string", pattern: "^pol_[a-f0-9]{64}$" },
    target: remoteCommandTargetSchema,
    sequence: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    previousSnapshotId: {
      oneOf: [
        { type: "null" },
        { type: "string", pattern: "^pol_[a-f0-9]{64}$" },
      ],
    },
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    rules: {
      type: "array",
      minItems: 1,
      maxItems: 256,
      items: policyRuleSchema,
    },
  },
  required: [
    "schemaVersion",
    "snapshotId",
    "target",
    "sequence",
    "previousSnapshotId",
    "issuedAt",
    "expiresAt",
    "rules",
  ],
  additionalProperties: false,
} as const;

export const signedPolicySnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-policy-snapshot.schema.json",
  title: "Lervo signed project policy snapshot",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    snapshot: { $ref: policySnapshotSchema.$id },
    signature: signatureSchema,
  },
  required: ["schemaVersion", "snapshot", "signature"],
  additionalProperties: false,
} as const;

export const policyApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/policy-approval.schema.json",
  title: "Lervo command-bound policy approval",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approvalId: { type: "string", pattern: "^apr_[a-f0-9]{64}$" },
    target: remoteCommandTargetSchema,
    snapshotId: { type: "string", pattern: "^pol_[a-f0-9]{64}$" },
    snapshotHash: sha256Schema,
    commandId: { type: "string", pattern: "^rcm_[a-f0-9]{64}$" },
    commandHash: sha256Schema,
    commandSignerKeyId: keyIdSchema,
    capability: capabilityNameSchema,
    approverSubjectHash: sha256Schema,
    grantedAt: timestampSchema,
    expiresAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "approvalId",
    "target",
    "snapshotId",
    "snapshotHash",
    "commandId",
    "commandHash",
    "commandSignerKeyId",
    "capability",
    "approverSubjectHash",
    "grantedAt",
    "expiresAt",
  ],
  additionalProperties: false,
} as const;

export const signedPolicyApprovalSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-policy-approval.schema.json",
  title: "Lervo signed command policy approval",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    approval: { $ref: policyApprovalSchema.$id },
    signature: signatureSchema,
  },
  required: ["schemaVersion", "approval", "signature"],
  additionalProperties: false,
} as const;

export const policyApprovalRevocationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/policy-approval-revocation.schema.json",
  title: "Lervo policy approval revocation",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    revocationId: { type: "string", pattern: "^apv_[a-f0-9]{64}$" },
    target: remoteCommandTargetSchema,
    approvalId: { type: "string", pattern: "^apr_[a-f0-9]{64}$" },
    revokedAt: timestampSchema,
    reasonCode: {
      type: "string",
      enum: ["cancelled", "superseded", "security_policy_changed"],
    },
  },
  required: [
    "schemaVersion",
    "revocationId",
    "target",
    "approvalId",
    "revokedAt",
    "reasonCode",
  ],
  additionalProperties: false,
} as const;

export const signedPolicyApprovalRevocationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-policy-approval-revocation.schema.json",
  title: "Lervo signed policy approval revocation",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    revocation: { $ref: policyApprovalRevocationSchema.$id },
    signature: signatureSchema,
  },
  required: ["schemaVersion", "revocation", "signature"],
  additionalProperties: false,
} as const;

export type PolicyRule = FromSchema<typeof policyRuleSchema>;
export type PolicySnapshot = FromSchema<typeof policySnapshotSchema>;
export type SignedPolicySnapshot = FromSchema<
  typeof signedPolicySnapshotSchema,
  { references: [typeof policySnapshotSchema] }
>;
export type PolicyApproval = FromSchema<typeof policyApprovalSchema>;
export type SignedPolicyApproval = FromSchema<
  typeof signedPolicyApprovalSchema,
  { references: [typeof policyApprovalSchema] }
>;
export type PolicyApprovalRevocation = FromSchema<typeof policyApprovalRevocationSchema>;
export type SignedPolicyApprovalRevocation = FromSchema<
  typeof signedPolicyApprovalRevocationSchema,
  { references: [typeof policyApprovalRevocationSchema] }
>;
