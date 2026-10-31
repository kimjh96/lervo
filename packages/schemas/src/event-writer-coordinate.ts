import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, sha256Schema, timestampSchema } from "./common.js";
import { eventReaderCapabilitiesValueSchema } from "./event-reader-capabilities.js";

const eventReaderActivationEvidenceValueSchema = {
  type: "object",
  properties: {
    readerId: { type: "string", pattern: "^reader_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$" },
    readerKind: { type: "string", enum: ["local", "node", "hub"] },
    peerIdentityHash: { anyOf: [sha256Schema, { type: "null" }] },
    capabilities: eventReaderCapabilitiesValueSchema,
  },
  required: ["readerId", "readerKind", "peerIdentityHash", "capabilities"],
  additionalProperties: false,
} as const;

const eventReaderActivationEvidenceListSchema = {
  type: "array",
  minItems: 1,
  maxItems: 32,
  items: eventReaderActivationEvidenceValueSchema,
} as const;

const distributedReaderInventoryAuthorityValueSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["repository_node_fleet_v1", "repository_node_absent_v1"] },
    repositoryIdentityHash: sha256Schema,
    inventoryHash: sha256Schema,
  },
  required: ["kind", "repositoryIdentityHash", "inventoryHash"],
  additionalProperties: false,
} as const;

export const eventWriterActivationEvidenceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event-writer-activation-evidence.schema.json",
  title: "Lervo event writer activation evidence",
  oneOf: [
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        projectId: projectIdSchema,
        observedAt: timestampSchema,
        readers: eventReaderActivationEvidenceListSchema,
      },
      required: ["schemaVersion", "projectId", "observedAt", "readers"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 2 },
        projectId: projectIdSchema,
        observedAt: timestampSchema,
        authority: distributedReaderInventoryAuthorityValueSchema,
        readers: eventReaderActivationEvidenceListSchema,
      },
      required: ["schemaVersion", "projectId", "observedAt", "authority", "readers"],
      additionalProperties: false,
    },
  ],
} as const;

const activationValueSchema = {
  type: "object",
  properties: {
    activationId: { type: "string", pattern: "^evact_[a-f0-9]{24}$" },
    observedAt: timestampSchema,
    configurationHash: sha256Schema,
    readers: eventReaderActivationEvidenceListSchema,
  },
  required: ["activationId", "observedAt", "configurationHash", "readers"],
  additionalProperties: false,
} as const;

export const eventWriterCoordinateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event-writer-coordinate.schema.json",
  title: "Lervo selected event writer coordinate",
  oneOf: [
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 6 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 7 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },

    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 5 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 6 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 4 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 5 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 3 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 4 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 2 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 3 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 1 },
        activationEvidence: { type: "null" },
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { type: "integer", const: 1 },
        projectId: projectIdSchema,
        selectedEventSchemaVersion: { type: "integer", const: 2 },
        activationEvidence: activationValueSchema,
      },
      required: ["schemaVersion", "projectId", "selectedEventSchemaVersion", "activationEvidence"],
      additionalProperties: false,
    },
  ],
} as const;

export type EventReaderActivationEvidence = FromSchema<
  typeof eventReaderActivationEvidenceValueSchema
>;
export type EventWriterActivationEvidence = FromSchema<typeof eventWriterActivationEvidenceSchema>;
export type DistributedReaderInventoryAuthority = FromSchema<
  typeof distributedReaderInventoryAuthorityValueSchema
>;
export type EventWriterCoordinate = FromSchema<typeof eventWriterCoordinateSchema>;
