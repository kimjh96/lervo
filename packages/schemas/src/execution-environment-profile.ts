import type { FromSchema } from "json-schema-to-ts";

import { adapterIdSchema } from "./adapter-primitives.js";
import { providerSchema, sha256Schema } from "./common.js";

export const repositoryPerformanceProfiles = ["small", "medium", "large", "custom"] as const;
export const repositoryPerformanceProfileSchema = {
  type: "string",
  enum: repositoryPerformanceProfiles,
} as const;

export const executionEnvironmentProfileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/execution-environment-profile.schema.json",
  type: "object",
  properties: {
    kind: { const: "execution_environment_profile" },
    schemaVersion: { type: "integer", const: 1 },
    profileSource: { type: "string", enum: ["runtime_derived", "benchmark_declared"] },
    lervoBuildDigest: sha256Schema,
    adapterId: { anyOf: [adapterIdSchema, { type: "null" }] },
    adapterVersion: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    provider: { anyOf: [providerSchema, { type: "null" }] },
    operatingSystem: { type: "string", minLength: 1, maxLength: 64 },
    architecture: { type: "string", minLength: 1, maxLength: 64 },
    nodeVersion: { type: "string", minLength: 1, maxLength: 64 },
    repositoryProfile: repositoryPerformanceProfileSchema,
    repositoryDocumentCount: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    repositoryByteCount: {
      anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    },
    cacheState: { type: "string", enum: ["cold", "warm", "unknown"] },
    concurrency: { type: "integer", minimum: 1, maximum: 256 },
  },
  required: [
    "kind",
    "schemaVersion",
    "profileSource",
    "lervoBuildDigest",
    "adapterId",
    "adapterVersion",
    "provider",
    "operatingSystem",
    "architecture",
    "nodeVersion",
    "repositoryProfile",
    "repositoryDocumentCount",
    "repositoryByteCount",
    "cacheState",
    "concurrency",
  ],
  allOf: [
    {
      if: { properties: { adapterId: { type: "null" } }, required: ["adapterId"] },
      then: {
        properties: { adapterVersion: { type: "null" }, provider: { type: "null" } },
      },
      else: {
        properties: {
          adapterVersion: { type: "string", minLength: 1 },
          provider: providerSchema,
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export type RepositoryPerformanceProfile = FromSchema<typeof repositoryPerformanceProfileSchema>;
export type ExecutionEnvironmentProfile = FromSchema<typeof executionEnvironmentProfileSchema>;
