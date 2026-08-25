import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  runIdSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  verificationSuiteIdSchema,
} from "./common.js";

export const remoteCommandTargetSchema = {
  type: "object",
  properties: {
    projectId: projectIdSchema,
    projectIdentityHash: sha256Schema,
  },
  required: ["projectId", "projectIdentityHash"],
  additionalProperties: false,
} as const;

export const remoteCommandPayloadReferenceSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 1, maximum: 65_536 },
    mediaType: { type: "string", const: "text/plain; charset=utf-8" },
  },
  required: ["artifactId", "contentHash", "byteCount", "mediaType"],
  additionalProperties: false,
} as const;

export const managedRunRemoteCommandActionSchema = {
  type: "object",
  properties: {
    kind: { type: "string", const: "managed_run" },
    roleId: roleIdSchema,
    provider: providerSchema,
    risk: { type: "string", enum: ["low", "medium", "high"] },
    verificationSuiteIds: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: verificationSuiteIdSchema,
    },
    request: remoteCommandPayloadReferenceSchema,
  },
  required: ["kind", "roleId", "provider", "risk", "verificationSuiteIds", "request"],
  additionalProperties: false,
} as const;

export const remoteCommandSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/remote-command.schema.json",
  title: "Lervo signed remote command content",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    commandId: { type: "string", pattern: "^rcm_[a-f0-9]{64}$" },
    idempotencyKey: {
      type: "string",
      pattern: "^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
    },
    nonce: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    target: remoteCommandTargetSchema,
    action: managedRunRemoteCommandActionSchema,
  },
  required: [
    "schemaVersion",
    "commandId",
    "idempotencyKey",
    "nonce",
    "issuedAt",
    "expiresAt",
    "target",
    "action",
  ],
  additionalProperties: false,
} as const;

export const signedRemoteCommandSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/signed-remote-command.schema.json",
  title: "Lervo signed remote command envelope",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    command: { $ref: remoteCommandSchema.$id },
    signature: {
      type: "object",
      properties: {
        algorithm: { type: "string", const: "ed25519" },
        keyId: {
          type: "string",
          pattern: "^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$",
        },
        value: { type: "string", pattern: "^[A-Za-z0-9_-]{86}$" },
      },
      required: ["algorithm", "keyId", "value"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "command", "signature"],
  additionalProperties: false,
} as const;

const receiptCommonProperties = {
  schemaVersion: schemaVersionSchema,
  commandId: { type: "string", pattern: "^rcm_[a-f0-9]{64}$" },
  commandHash: sha256Schema,
  idempotencyKey: {
    type: "string",
    pattern: "^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$",
  },
  processedAt: timestampSchema,
} as const;
const receiptCommonRequired = [
  "schemaVersion",
  "commandId",
  "commandHash",
  "idempotencyKey",
  "processedAt",
] as const;

export const remoteCommandExecutionReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/remote-command-execution-receipt.schema.json",
  title: "Lervo local remote command execution receipt",
  oneOf: [
    {
      type: "object",
      properties: {
        ...receiptCommonProperties,
        outcome: { type: "string", const: "executed" },
        runId: runIdSchema,
      },
      required: [...receiptCommonRequired, "outcome", "runId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...receiptCommonProperties,
        outcome: { type: "string", const: "failed" },
        failureCode: {
          type: "string",
          enum: ["payload_unavailable", "payload_mismatch", "execution_failed"],
        },
      },
      required: [...receiptCommonRequired, "outcome", "failureCode"],
      additionalProperties: false,
    },
  ],
} as const;

const remoteCommandDeliveryCommonProperties = {
  schemaVersion: schemaVersionSchema,
  deliveryId: { type: "string", pattern: "^rcd_[a-f0-9]{64}$" },
  leaseId: { type: "string", pattern: "^rcl_[A-Za-z0-9_-]{43}$" },
  commandId: { type: "string", pattern: "^rcm_[a-f0-9]{64}$" },
  commandHash: sha256Schema,
} as const;

export const remoteCommandLeaseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/remote-command-lease.schema.json",
  title: "Lervo durable remote command lease",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryId: remoteCommandDeliveryCommonProperties.deliveryId,
    leaseId: remoteCommandDeliveryCommonProperties.leaseId,
    leasedTo: {
      type: "string",
      pattern: "^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
    },
    leasedAt: timestampSchema,
    leaseExpiresAt: timestampSchema,
    envelope: { $ref: signedRemoteCommandSchema.$id },
  },
  required: [
    "schemaVersion",
    "deliveryId",
    "leaseId",
    "leasedTo",
    "leasedAt",
    "leaseExpiresAt",
    "envelope",
  ],
  additionalProperties: false,
} as const;

export const remoteCommandDeliveryAcknowledgementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/remote-command-delivery-acknowledgement.schema.json",
  title: "Lervo remote command delivery acknowledgement",
  oneOf: [
    {
      type: "object",
      properties: {
        ...remoteCommandDeliveryCommonProperties,
        acknowledgedAt: timestampSchema,
        disposition: { type: "string", const: "completed" },
        receipt: { $ref: remoteCommandExecutionReceiptSchema.$id },
      },
      required: [
        "schemaVersion",
        "deliveryId",
        "leaseId",
        "commandId",
        "commandHash",
        "acknowledgedAt",
        "disposition",
        "receipt",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...remoteCommandDeliveryCommonProperties,
        acknowledgedAt: timestampSchema,
        disposition: { type: "string", const: "rejected" },
        rejectionCode: {
          type: "string",
          enum: [
            "invalid_command",
            "unknown_signer",
            "invalid_signature",
            "signer_scope_denied",
            "target_mismatch",
            "command_expired",
            "command_lifetime_exceeded",
            "idempotency_conflict",
            "nonce_replay",
          ],
        },
      },
      required: [
        "schemaVersion",
        "deliveryId",
        "leaseId",
        "commandId",
        "commandHash",
        "acknowledgedAt",
        "disposition",
        "rejectionCode",
      ],
      additionalProperties: false,
    },
  ],
} as const;

export const remoteCommandDeliveryConfirmationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/remote-command-delivery-confirmation.schema.json",
  title: "Lervo durable remote command delivery confirmation",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    deliveryId: remoteCommandDeliveryCommonProperties.deliveryId,
    commandId: remoteCommandDeliveryCommonProperties.commandId,
    acknowledgementHash: sha256Schema,
    status: { type: "string", enum: ["accepted", "duplicate"] },
    disposition: { type: "string", enum: ["completed", "rejected"] },
    confirmedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "deliveryId",
    "commandId",
    "acknowledgementHash",
    "status",
    "disposition",
    "confirmedAt",
  ],
  additionalProperties: false,
} as const;

export type RemoteCommandTarget = FromSchema<typeof remoteCommandTargetSchema>;
export type RemoteCommandPayloadReference = FromSchema<typeof remoteCommandPayloadReferenceSchema>;
export type ManagedRunRemoteCommandAction = FromSchema<typeof managedRunRemoteCommandActionSchema>;
export type RemoteCommand = FromSchema<typeof remoteCommandSchema>;
export type SignedRemoteCommand = FromSchema<
  typeof signedRemoteCommandSchema,
  { references: [typeof remoteCommandSchema] }
>;
export type RemoteCommandExecutionReceipt = FromSchema<typeof remoteCommandExecutionReceiptSchema>;
export type RemoteCommandLease = FromSchema<
  typeof remoteCommandLeaseSchema,
  { references: [typeof remoteCommandSchema, typeof signedRemoteCommandSchema] }
>;
export type RemoteCommandDeliveryAcknowledgement = FromSchema<
  typeof remoteCommandDeliveryAcknowledgementSchema,
  { references: [typeof remoteCommandExecutionReceiptSchema] }
>;
export type RemoteCommandDeliveryConfirmation = FromSchema<
  typeof remoteCommandDeliveryConfirmationSchema
>;
