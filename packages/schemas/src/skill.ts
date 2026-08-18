import type { FromSchema } from "json-schema-to-ts";

import {
  capabilityNameSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  schemaReferenceSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  skillIdSchema,
  timestampSchema,
} from "./common.js";

const providerCompatibilitySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { const: "any" },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "allowlist" },
        providers: {
          type: "array",
          items: providerSchema,
          minItems: 1,
          uniqueItems: true,
        },
      },
      required: ["mode", "providers"],
      additionalProperties: false,
    },
  ],
} as const;

const enabledScopeSchema = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "disabled" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "user" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "projects" },
        projectIds: {
          type: "array",
          items: projectIdSchema,
          minItems: 1,
          uniqueItems: true,
        },
      },
      required: ["kind", "projectIds"],
      additionalProperties: false,
    },
  ],
} as const;

export const skillManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/skill-manifest.schema.json",
  title: "Lervo versioned skill manifest",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    skillId: skillIdSchema,
    version: semverSchema,
    contentHash: sha256Schema,
    source: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["project", "user", "organization", "external"],
        },
        uri: { type: "string", minLength: 1, maxLength: 1000 },
        publisher: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1, maxLength: 150 },
            name: { type: "string", minLength: 1, maxLength: 200 },
          },
          required: ["id", "name"],
          additionalProperties: false,
        },
      },
      required: ["kind", "uri", "publisher"],
      additionalProperties: false,
    },
    supportedRoles: {
      type: "array",
      items: roleIdSchema,
      minItems: 1,
      uniqueItems: true,
    },
    compatibility: {
      type: "object",
      properties: {
        providers: providerCompatibilitySchema,
        minimumRuntimeVersion: semverSchema,
        platforms: {
          type: "array",
          items: { type: "string", enum: ["darwin", "linux", "win32"] },
          minItems: 1,
          uniqueItems: true,
        },
        requiredTools: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 150 },
          uniqueItems: true,
        },
        unknownIsCompatible: { const: false },
      },
      required: [
        "providers",
        "minimumRuntimeVersion",
        "platforms",
        "requiredTools",
        "unknownIsCompatible"
      ],
      additionalProperties: false,
    },
    requiredCapabilities: {
      type: "array",
      items: capabilityNameSchema,
      uniqueItems: true,
    },
    contracts: {
      type: "object",
      properties: {
        inputSchemaRef: schemaReferenceSchema,
        outputSchemaRef: schemaReferenceSchema,
      },
      required: ["inputSchemaRef", "outputSchemaRef"],
      additionalProperties: false,
    },
    trust: {
      oneOf: [
        {
          type: "object",
          properties: {
            level: { const: "untrusted" },
            signatureStatus: {
              type: "string",
              enum: ["unsigned", "invalid", "unknown"],
            },
          },
          required: ["level", "signatureStatus"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            level: { const: "reviewed" },
            signatureStatus: {
              type: "string",
              enum: ["unsigned", "valid", "invalid", "unknown"],
            },
            reviewedBy: { type: "string", minLength: 1, maxLength: 150 },
            reviewedAt: timestampSchema,
          },
          required: ["level", "signatureStatus", "reviewedBy", "reviewedAt"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            level: { const: "verified" },
            signatureStatus: { const: "valid" },
            reviewedBy: { type: "string", minLength: 1, maxLength: 150 },
            reviewedAt: timestampSchema,
          },
          required: ["level", "signatureStatus", "reviewedBy", "reviewedAt"],
          additionalProperties: false,
        },
      ],
    },
    enabledScope: enabledScopeSchema,
    pinned: { type: "boolean" },
  },
  required: [
    "schemaVersion",
    "skillId",
    "version",
    "contentHash",
    "source",
    "supportedRoles",
    "compatibility",
    "requiredCapabilities",
    "contracts",
    "trust",
    "enabledScope",
    "pinned"
  ],
  additionalProperties: false,
} as const;

export type SkillManifest = FromSchema<typeof skillManifestSchema>;
