import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  sha256Schema,
  verificationCommandIdSchema,
  verificationIdSchema,
  verificationSuiteIdSchema,
} from "./common.js";

export const verificationStartedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/verification-started-event-payload.schema.json",
  type: "object",
  properties: {
    suiteId: verificationSuiteIdSchema,
    suiteHash: sha256Schema,
    repositoryRevision: sha256Schema,
  },
  required: ["suiteId", "suiteHash", "repositoryRevision"],
  additionalProperties: false,
} as const;

export const verificationCompletedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/verification-completed-event-payload.schema.json",
  type: "object",
  properties: {
    verificationId: verificationIdSchema,
    suiteId: verificationSuiteIdSchema,
    suiteHash: sha256Schema,
    repositoryRevision: sha256Schema,
    status: { type: "string", enum: ["passed", "failed", "cancelled"] },
    resultArtifactId: artifactIdSchema,
    resultContentHash: sha256Schema,
    nonPassedCommandIds: {
      type: "array",
      items: verificationCommandIdSchema,
      maxItems: 32,
      uniqueItems: true,
    },
  },
  required: [
    "verificationId",
    "suiteId",
    "suiteHash",
    "repositoryRevision",
    "status",
    "resultArtifactId",
    "resultContentHash",
    "nonPassedCommandIds",
  ],
  additionalProperties: false,
} as const;

export type VerificationStartedEventPayload = FromSchema<
  typeof verificationStartedEventPayloadSchema
>;
export type VerificationCompletedEventPayload = FromSchema<
  typeof verificationCompletedEventPayloadSchema
>;
