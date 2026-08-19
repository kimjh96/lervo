import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  repositoryRelativePathSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  verificationCommandIdSchema,
  verificationIdSchema,
  verificationSuiteIdSchema,
} from "./common.js";

const environmentVariableNameSchema = {
  type: "string",
  pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
  maxLength: 100,
} as const;

const verificationCommandSchema = {
  type: "object",
  properties: {
    commandId: verificationCommandIdSchema,
    executable: {
      type: "string",
      pattern: "^(?:[A-Za-z0-9][A-Za-z0-9._-]*|\\./[A-Za-z0-9][A-Za-z0-9._/-]*)$",
      maxLength: 500,
    },
    arguments: {
      type: "array",
      items: { type: "string", maxLength: 2000 },
      maxItems: 200,
    },
    cwd: { ...repositoryRelativePathSchema, maxLength: 500 },
    timeoutMs: { type: "integer", minimum: 100, maximum: 1_800_000 },
    maxOutputBytes: { type: "integer", minimum: 1024, maximum: 16_777_216 },
    environmentVariableNames: {
      type: "array",
      items: environmentVariableNameSchema,
      maxItems: 32,
      uniqueItems: true,
    },
  },
  required: [
    "commandId",
    "executable",
    "arguments",
    "cwd",
    "timeoutMs",
    "maxOutputBytes",
    "environmentVariableNames",
  ],
  additionalProperties: false,
} as const;

export const verificationSuiteSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/verification-suite.schema.json",
  title: "Lervo verification suite",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    suiteId: verificationSuiteIdSchema,
    stopOnFailure: { const: true },
    commands: {
      type: "array",
      items: verificationCommandSchema,
      minItems: 1,
      maxItems: 32,
    },
  },
  required: ["schemaVersion", "suiteId", "stopOnFailure", "commands"],
  additionalProperties: false,
} as const;

const verificationOutputArtifactSchema = {
  type: "object",
  properties: {
    artifactId: artifactIdSchema,
    uri: { type: "string", pattern: "^lervo-cas://sha256/[a-f0-9]{64}$" },
    contentHash: sha256Schema,
    byteCount: { type: "integer", minimum: 0 },
  },
  required: ["artifactId", "uri", "contentHash", "byteCount"],
  additionalProperties: false,
} as const;

const verificationCommandResultSchema = {
  type: "object",
  properties: {
    commandId: verificationCommandIdSchema,
    commandDigest: sha256Schema,
    status: {
      type: "string",
      enum: [
        "passed",
        "failed",
        "timed_out",
        "output_limit_exceeded",
        "execution_error",
        "cancelled",
        "not_run",
      ],
    },
    exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
    startedAt: { anyOf: [timestampSchema, { type: "null" }] },
    completedAt: { anyOf: [timestampSchema, { type: "null" }] },
    durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    stdoutArtifact: {
      anyOf: [verificationOutputArtifactSchema, { type: "null" }],
    },
    stderrArtifact: {
      anyOf: [verificationOutputArtifactSchema, { type: "null" }],
    },
    failureCode: {
      anyOf: [
        {
          type: "string",
          enum: [
            "nonzero_exit",
            "timeout",
            "output_limit_exceeded",
            "execution_failed",
            "cancelled",
            "blocked_by_previous_failure",
          ],
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "commandId",
    "commandDigest",
    "status",
    "exitCode",
    "startedAt",
    "completedAt",
    "durationMs",
    "stdoutArtifact",
    "stderrArtifact",
    "failureCode",
  ],
  additionalProperties: false,
} as const;

export const verificationResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/verification-result.schema.json",
  title: "Lervo verification result",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    verificationId: verificationIdSchema,
    suiteId: verificationSuiteIdSchema,
    suiteHash: sha256Schema,
    repositoryRevision: sha256Schema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    status: { type: "string", enum: ["passed", "failed", "cancelled"] },
    commands: {
      type: "array",
      items: verificationCommandResultSchema,
      minItems: 1,
      maxItems: 32,
    },
  },
  required: [
    "schemaVersion",
    "verificationId",
    "suiteId",
    "suiteHash",
    "repositoryRevision",
    "startedAt",
    "completedAt",
    "status",
    "commands",
  ],
  additionalProperties: false,
} as const;

export type VerificationSuite = FromSchema<typeof verificationSuiteSchema>;
export type VerificationCommand = VerificationSuite["commands"][number];
export type VerificationResult = FromSchema<typeof verificationResultSchema>;
export type VerificationCommandResult = VerificationResult["commands"][number];
