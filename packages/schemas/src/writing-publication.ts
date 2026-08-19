import type { FromSchema } from "json-schema-to-ts";

import {
  artifactIdSchema,
  sha256Schema,
  timestampSchema,
  writingEvaluationIdSchema,
  writingPolicyIdSchema,
  writingPublicationPermitIdSchema,
} from "./common.js";
import { writingSurfaces } from "./writing.js";

export const writingPublicationPermitValueSchema = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    permitId: writingPublicationPermitIdSchema,
    surface: { type: "string", enum: writingSurfaces },
    artifactId: artifactIdSchema,
    contentHash: sha256Schema,
    writingPolicyId: writingPolicyIdSchema,
    writingPolicyHash: sha256Schema,
    evaluationId: writingEvaluationIdSchema,
    evaluationHash: sha256Schema,
    issuedAt: timestampSchema,
  },
  required: [
    "schemaVersion",
    "permitId",
    "surface",
    "artifactId",
    "contentHash",
    "writingPolicyId",
    "writingPolicyHash",
    "evaluationId",
    "evaluationHash",
    "issuedAt",
  ],
  additionalProperties: false,
} as const;

export const writingPublicationPermitSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/writing-publication-permit.schema.json",
  title: "Lervo content-bound writing publication permit",
  ...writingPublicationPermitValueSchema,
} as const;

export type WritingPublicationPermit = FromSchema<
  typeof writingPublicationPermitSchema
>;
