import type { FromSchema } from "json-schema-to-ts";

import {
  projectIdSchema,
  providerSchema,
  runIdSchema,
  schemaReferenceSchema,
  schemaVersionSchema,
  semverSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { adapterIdSchema } from "./adapter-primitives.js";
import { capabilityPackageIdSchema } from "./capability-package.js";

const environmentNameSchema = {
  type: "string",
  pattern: "^[A-Z][A-Z0-9_]{0,99}$",
} as const;

const mcpServerNameSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9._-]{0,99}$",
} as const;

export const mcpRuntimeDescriptorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/mcp-runtime-descriptor.schema.json",
  title: "Lervo provider-neutral MCP runtime descriptor",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    serverName: mcpServerNameSchema,
    transport: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "stdio" },
            command: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$" },
            entrypointPath: schemaReferenceSchema,
            arguments: {
              type: "array",
              items: { type: "string", maxLength: 1000 },
              maxItems: 64,
            },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 },
          },
          required: ["kind", "command", "entrypointPath", "arguments", "timeoutMs"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "http" },
            url: { type: "string", minLength: 1, maxLength: 2000 },
            bearerTokenCredential: { anyOf: [environmentNameSchema, { type: "null" }] },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 },
          },
          required: ["kind", "url", "bearerTokenCredential", "timeoutMs"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["schemaVersion", "serverName", "transport"],
  additionalProperties: false,
} as const;

const activationCoordinateSchema = {
  capabilityId: capabilityPackageIdSchema,
  version: semverSchema,
  contentHash: sha256Schema,
} as const;

export const adapterCapabilityActivationRequestSchema = {
  type: "object",
  properties: {
    kind: { const: "capability_activation_request" },
    schemaVersion: schemaVersionSchema,
    ...activationCoordinateSchema,
    capabilityKind: { type: "string", enum: ["mcp_server", "provider_plugin"] },
    runtime: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "mcp_stdio" },
            serverName: mcpServerNameSchema,
            command: { type: "string", minLength: 1, maxLength: 4096 },
            arguments: { type: "array", items: { type: "string", maxLength: 4096 }, maxItems: 65 },
            credentialNames: {
              type: "array",
              items: environmentNameSchema,
              uniqueItems: true,
              maxItems: 32,
            },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 },
          },
          required: ["kind", "serverName", "command", "arguments", "credentialNames", "timeoutMs"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "mcp_http" },
            serverName: mcpServerNameSchema,
            url: { type: "string", minLength: 1, maxLength: 2000 },
            bearerTokenCredential: { anyOf: [environmentNameSchema, { type: "null" }] },
            timeoutMs: { type: "integer", minimum: 1000, maximum: 30000 },
          },
          required: ["kind", "serverName", "url", "bearerTokenCredential", "timeoutMs"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "provider_plugin" },
            provider: providerSchema,
            pluginRoot: { type: "string", minLength: 1, maxLength: 4096 },
            pluginManifestPath: schemaReferenceSchema,
          },
          required: ["kind", "provider", "pluginRoot", "pluginManifestPath"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: [
    "kind",
    "schemaVersion",
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "runtime",
  ],
  allOf: [
    {
      if: {
        type: "object",
        properties: {
          runtime: {
            type: "object",
            properties: { kind: { const: "provider_plugin" } },
            required: ["kind"],
          },
        },
        required: ["runtime"],
      },
      then: { type: "object", properties: { capabilityKind: { const: "provider_plugin" } } },
      else: { type: "object", properties: { capabilityKind: { const: "mcp_server" } } },
    },
  ],
  additionalProperties: false,
} as const;

export const adapterCapabilityActivationReceiptSchema = {
  type: "object",
  properties: {
    kind: { const: "capability_activation_receipt" },
    schemaVersion: schemaVersionSchema,
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    ...activationCoordinateSchema,
    capabilityKind: { type: "string", enum: ["mcp_server", "provider_plugin"] },
    evidence: { type: "string", enum: ["mcp_connected", "plugin_loaded"] },
    activationDigest: sha256Schema,
    confirmedAt: timestampSchema,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "evidence",
    "activationDigest",
    "confirmedAt",
  ],
  additionalProperties: false,
} as const;

export const capabilityActivatedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/capability-activated-event-payload.schema.json",
  type: "object",
  properties: {
    ...activationCoordinateSchema,
    capabilityKind: { type: "string", enum: ["mcp_server", "provider_plugin"] },
    adapterId: adapterIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    evidence: { type: "string", enum: ["mcp_connected", "plugin_loaded"] },
    activationDigest: sha256Schema,
  },
  required: [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "adapterId",
    "providerSessionId",
    "evidence",
    "activationDigest",
  ],
  additionalProperties: false,
} as const;

export type McpRuntimeDescriptor = FromSchema<typeof mcpRuntimeDescriptorSchema>;
export type AdapterCapabilityActivationRequest = FromSchema<
  typeof adapterCapabilityActivationRequestSchema
>;
export type AdapterCapabilityActivationReceipt = FromSchema<
  typeof adapterCapabilityActivationReceiptSchema
>;
export type CapabilityActivatedEventPayload = FromSchema<
  typeof capabilityActivatedEventPayloadSchema
>;
