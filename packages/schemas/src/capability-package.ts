import type { FromSchema } from "json-schema-to-ts";

import {
  capabilityNameSchema,
  projectIdSchema,
  providerSchema,
  schemaReferenceSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  skillIdSchema,
  timestampSchema,
} from "./common.js";

export const capabilityPackageIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$",
  maxLength: 150,
} as const;

const coordinateSchema = {
  type: "object",
  properties: {
    capabilityId: capabilityPackageIdSchema,
    version: semverSchema,
    contentHash: sha256Schema,
  },
  required: ["capabilityId", "version", "contentHash"],
  additionalProperties: false,
} as const;

const providerCompatibilitySchema = {
  oneOf: [
    {
      type: "object",
      properties: { mode: { const: "any" } },
      required: ["mode"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "allowlist" },
        providers: { type: "array", items: providerSchema, minItems: 1, uniqueItems: true },
      },
      required: ["mode", "providers"],
      additionalProperties: false,
    },
  ],
} as const;

export const capabilityPackageManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/capability-package-manifest.schema.json",
  title: "Lervo local-first capability package manifest",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    capabilityId: capabilityPackageIdSchema,
    kind: { type: "string", enum: ["skill", "mcp_server", "provider_plugin", "bundle"] },
    version: semverSchema,
    contentHash: sha256Schema,
    source: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["project", "user", "hub", "external"] },
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
      },
      required: ["providers", "minimumRuntimeVersion", "platforms"],
      additionalProperties: false,
    },
    requiredPermissions: { type: "array", items: capabilityNameSchema, uniqueItems: true },
    dependencies: { type: "array", items: coordinateSchema, uniqueItems: true, maxItems: 64 },
    discovery: {
      type: "object",
      properties: {
        displayName: { type: "string", minLength: 1, maxLength: 120 },
        summary: { type: "string", minLength: 1, maxLength: 500 },
        keywords: {
          type: "array",
          items: { type: "string", minLength: 2, maxLength: 80 },
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
        },
        intents: {
          type: "array",
          items: { type: "string", minLength: 3, maxLength: 200 },
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
        },
        autoSelect: { type: "boolean" },
      },
      required: ["displayName", "summary", "keywords", "intents", "autoSelect"],
      additionalProperties: false,
    },
    entrypoint: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "skill" },
            skillId: skillIdSchema,
            manifestPath: { const: "lervo-skill.json" },
          },
          required: ["kind", "skillId", "manifestPath"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "mcp_server" },
            adapterId: { type: "string", pattern: "^[a-z][a-z0-9._-]{0,99}$" },
            configurationSchemaRef: schemaReferenceSchema,
            runtimeDescriptorPath: schemaReferenceSchema,
            credentialNames: {
              type: "array",
              items: { type: "string", pattern: "^[A-Z][A-Z0-9_]{0,99}$" },
              uniqueItems: true,
              maxItems: 32,
            },
          },
          required: [
            "kind",
            "adapterId",
            "configurationSchemaRef",
            "runtimeDescriptorPath",
            "credentialNames",
          ],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "provider_plugin" },
            provider: providerSchema,
            pluginManifestPath: {
              type: "string",
              pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000]+$",
              maxLength: 500,
            },
          },
          required: ["kind", "provider", "pluginManifestPath"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "bundle" },
            members: {
              type: "array",
              items: coordinateSchema,
              minItems: 1,
              maxItems: 64,
              uniqueItems: true,
            },
          },
          required: ["kind", "members"],
          additionalProperties: false,
        },
      ],
    },
    activation: { const: "explicit" },
    publication: {
      type: "object",
      properties: {
        defaultVisibility: { const: "local" },
        secretMaterial: { const: "excluded" },
      },
      required: ["defaultVisibility", "secretMaterial"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "capabilityId",
    "kind",
    "version",
    "contentHash",
    "source",
    "compatibility",
    "requiredPermissions",
    "dependencies",
    "entrypoint",
    "activation",
    "publication",
  ],
  additionalProperties: false,
} as const;

export const capabilityLockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/capability-lock.schema.json",
  title: "Lervo resolved capability lock",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    projectId: projectIdSchema,
    generatedAt: timestampSchema,
    entries: {
      type: "array",
      maxItems: 128,
      items: {
        type: "object",
        properties: {
          capabilityId: capabilityPackageIdSchema,
          kind: { type: "string", enum: ["skill", "mcp_server", "provider_plugin", "bundle"] },
          version: semverSchema,
          contentHash: sha256Schema,
          source: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["project", "user"] },
              uri: { type: "string", minLength: 1, maxLength: 1000 },
            },
            required: ["kind", "uri"],
            additionalProperties: false,
          },
          activationStatus: { const: "resolved" },
        },
        required: ["capabilityId", "kind", "version", "contentHash", "source", "activationStatus"],
        additionalProperties: false,
      },
    },
  },
  required: ["schemaVersion", "projectId", "generatedAt", "entries"],
  additionalProperties: false,
} as const;

export type CapabilityPackageManifest = FromSchema<typeof capabilityPackageManifestSchema>;
export type CapabilityLock = FromSchema<typeof capabilityLockSchema>;
