import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, schemaVersionSchema, sha256Schema, timestampSchema } from "./common.js";
import { eventEnvelopeSchema, type EventEnvelope } from "./event.js";
import { projectManifestSchema } from "./project.js";

export const syncDestinationIdSchema = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$",
} as const;

export const projectRegistrationIdSchema = {
  type: "string",
  pattern: "^hpr_[a-f0-9]{64}$",
} as const;

export const outboundEventBatchIdSchema = {
  type: "string",
  pattern: "^hsb_[a-f0-9]{64}$",
} as const;

export const eventSyncCursorSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        seq: { type: "integer", const: 0 },
        eventHash: { type: "null" },
      },
      required: ["seq", "eventHash"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        seq: { type: "integer", minimum: 1 },
        eventHash: sha256Schema,
      },
      required: ["seq", "eventHash"],
      additionalProperties: false,
    },
  ],
} as const;

export const projectRegistrationRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/project-registration-request.schema.json",
  title: "Lervo Hub project registration request",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    registrationId: projectRegistrationIdSchema,
    destinationId: syncDestinationIdSchema,
    requestedAt: timestampSchema,
    project: { $ref: projectManifestSchema.$id },
    projectIdentityHash: sha256Schema,
    projectManifestHash: sha256Schema,
    syncPolicy: {
      type: "object",
      properties: {
        hubSyncEnabled: { type: "boolean", const: true },
        eventPayloadMode: { type: "string", const: "allowlist" },
        artifactMode: { type: "string", const: "none" },
      },
      required: ["hubSyncEnabled", "eventPayloadMode", "artifactMode"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "registrationId",
    "destinationId",
    "requestedAt",
    "project",
    "projectIdentityHash",
    "projectManifestHash",
    "syncPolicy",
  ],
  additionalProperties: false,
} as const;

export const projectRegistrationResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/project-registration-response.schema.json",
  title: "Lervo Hub project registration response",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    registrationId: projectRegistrationIdSchema,
    projectId: projectIdSchema,
    destinationId: syncDestinationIdSchema,
    status: { type: "string", enum: ["registered", "updated", "unchanged"] },
    cursor: eventSyncCursorSchema,
    acceptedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "registrationId",
    "projectId",
    "destinationId",
    "status",
    "cursor",
    "acceptedAt",
  ],
  additionalProperties: false,
} as const;

export const outboundEventBatchSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/outbound-event-batch.schema.json",
  title: "Lervo outbound event sync batch",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    batchId: outboundEventBatchIdSchema,
    registrationId: projectRegistrationIdSchema,
    projectId: projectIdSchema,
    destinationId: syncDestinationIdSchema,
    firstSeq: { type: "integer", minimum: 1 },
    lastSeq: { type: "integer", minimum: 1 },
    previousHash: { anyOf: [sha256Schema, { type: "null" }] },
    headHash: sha256Schema,
    events: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { $ref: eventEnvelopeSchema.$id },
    },
  },
  required: [
    "schemaVersion",
    "batchId",
    "registrationId",
    "projectId",
    "destinationId",
    "firstSeq",
    "lastSeq",
    "previousHash",
    "headHash",
    "events",
  ],
  additionalProperties: false,
} as const;

export const eventSyncAcknowledgementSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event-sync-acknowledgement.schema.json",
  title: "Lervo durable event sync acknowledgement",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    batchId: outboundEventBatchIdSchema,
    registrationId: projectRegistrationIdSchema,
    projectId: projectIdSchema,
    destinationId: syncDestinationIdSchema,
    status: { type: "string", enum: ["accepted", "duplicate"] },
    acceptedEventIds: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: "string", pattern: "^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" },
    },
    insertedCount: { type: "integer", minimum: 0, maximum: 100 },
    duplicateCount: { type: "integer", minimum: 0, maximum: 100 },
    cursor: eventSyncCursorSchema,
    bufferedEventCount: { type: "integer", minimum: 0 },
    acknowledgedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "batchId",
    "registrationId",
    "projectId",
    "destinationId",
    "status",
    "acceptedEventIds",
    "insertedCount",
    "duplicateCount",
    "cursor",
    "bufferedEventCount",
    "acknowledgedAt",
  ],
  additionalProperties: false,
} as const;

export type ProjectRegistrationRequest = FromSchema<
  typeof projectRegistrationRequestSchema,
  { references: [typeof projectManifestSchema] }
>;
export type ProjectRegistrationResponse = FromSchema<typeof projectRegistrationResponseSchema>;
type OutboundEventBatchSchema = FromSchema<
  typeof outboundEventBatchSchema,
  { references: [typeof eventEnvelopeSchema] }
>;
export type OutboundEventBatch = Omit<OutboundEventBatchSchema, "events"> & {
  events: EventEnvelope[];
};
export type EventSyncAcknowledgement = FromSchema<typeof eventSyncAcknowledgementSchema>;
export type EventSyncCursor = ProjectRegistrationResponse["cursor"];
