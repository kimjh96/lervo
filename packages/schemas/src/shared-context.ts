import type { FromSchema } from "json-schema-to-ts";

import {
  documentIdSchema,
  eventIdSchema,
  handoffIdSchema,
  projectIdSchema,
  roleIdSchema,
  runIdSchema,
  schemaVersionSchema,
  sessionIdSchema,
  sha256Schema,
  sharedContextIdSchema,
  timestampSchema,
} from "./common.js";

const agentProducerSchema = {
  type: "object",
  properties: {
    kind: { const: "agent" },
    roleId: roleIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
  },
  required: ["kind", "roleId", "runId", "sessionId"],
  additionalProperties: false,
} as const;

const nonAgentProducerSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["user", "system"] },
  },
  required: ["kind"],
  additionalProperties: false,
} as const;

const projectAudienceSchema = {
  type: "object",
  properties: {
    mode: { const: "project" },
  },
  required: ["mode"],
  additionalProperties: false,
} as const;

const roleAudienceSchema = {
  type: "object",
  properties: {
    mode: { const: "roles" },
    roleIds: {
      type: "array",
      items: roleIdSchema,
      minItems: 1,
      uniqueItems: true,
    },
  },
  required: ["mode", "roleIds"],
  additionalProperties: false,
} as const;

export const sharedContextPublicationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/shared-context-publication.schema.json",
  title: "Lervo shared context publication",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    sharedContextId: sharedContextIdSchema,
    projectId: projectIdSchema,
    kind: {
      type: "string",
      enum: [
        "instruction",
        "decision",
        "finding",
        "artifact_summary",
        "verification_result",
        "status_summary",
      ],
    },
    documentId: documentIdSchema,
    contentHash: sha256Schema,
    sourceRevision: { type: "string", minLength: 1, maxLength: 200 },
    producer: {
      oneOf: [agentProducerSchema, nonAgentProducerSchema],
    },
    audience: {
      oneOf: [projectAudienceSchema, roleAudienceSchema],
    },
    sensitivity: {
      type: "string",
      enum: ["normal", "restricted"],
    },
    evidenceEventIds: {
      type: "array",
      items: eventIdSchema,
      uniqueItems: true,
    },
    publishedAt: timestampSchema,
    expiresAt: {
      anyOf: [timestampSchema, { type: "null" }],
    },
    supersedesSharedContextId: {
      anyOf: [sharedContextIdSchema, { type: "null" }],
    },
  },
  required: [
    "schemaVersion",
    "sharedContextId",
    "projectId",
    "kind",
    "documentId",
    "contentHash",
    "sourceRevision",
    "producer",
    "audience",
    "sensitivity",
    "evidenceEventIds",
    "publishedAt",
    "expiresAt",
    "supersedesSharedContextId",
  ],
  allOf: [
    {
      if: {
        properties: {
          producer: {
            type: "object",
            properties: { kind: { const: "agent" } },
            required: ["kind"],
          },
        },
        required: ["producer"],
      },
      then: {
        properties: {
          evidenceEventIds: { type: "array", minItems: 1 },
        },
      },
    },
    {
      if: {
        properties: { sensitivity: { const: "restricted" } },
        required: ["sensitivity"],
      },
      then: {
        properties: { audience: roleAudienceSchema },
      },
    },
  ],
  additionalProperties: false,
} as const;

export const handoffBundleSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/handoff-bundle.schema.json",
  title: "Lervo role handoff bundle",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    handoffId: handoffIdSchema,
    projectId: projectIdSchema,
    from: {
      type: "object",
      properties: {
        roleId: roleIdSchema,
        runId: runIdSchema,
        sessionId: sessionIdSchema,
        contextGeneration: { type: "integer", minimum: 0 },
      },
      required: ["roleId", "runId", "sessionId", "contextGeneration"],
      additionalProperties: false,
    },
    toRoleId: roleIdSchema,
    requestDigest: sha256Schema,
    sharedContextIds: {
      type: "array",
      items: sharedContextIdSchema,
      minItems: 1,
      uniqueItems: true,
    },
    evidenceEventIds: {
      type: "array",
      items: eventIdSchema,
      minItems: 1,
      uniqueItems: true,
    },
    createdAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "handoffId",
    "projectId",
    "from",
    "toRoleId",
    "requestDigest",
    "sharedContextIds",
    "evidenceEventIds",
    "createdAt",
  ],
  additionalProperties: false,
} as const;

export type SharedContextPublication = FromSchema<typeof sharedContextPublicationSchema>;
export type HandoffBundle = FromSchema<typeof handoffBundleSchema>;
