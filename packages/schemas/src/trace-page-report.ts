import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, runIdSchema, sha256Schema } from "./common.js";
import { eventEnvelopeSchema } from "./event.js";
import { eventTypes } from "./event.js";

export const tracePageReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/trace-page-report.schema.json",
  title: "Lervo bounded trace page report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    projectId: projectIdSchema,
    runId: runIdSchema,
    integrity: {
      type: "object",
      properties: {
        valid: { type: "boolean", const: true },
        eventCount: { type: "integer", minimum: 1 },
        headHash: sha256Schema,
      },
      required: ["valid", "eventCount", "headHash"],
      additionalProperties: true,
    },
    page: {
      type: "object",
      properties: {
        afterSeq: { type: "integer", minimum: 0 },
        afterEventHash: { anyOf: [sha256Schema, { type: "null" }] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        returnedCount: { type: "integer", minimum: 1, maximum: 100 },
        hasMore: { type: "boolean" },
        nextCursor: {
          anyOf: [
            { type: "string", pattern: "^trc_[A-Za-z0-9_-]+\\.[a-f0-9]{64}$" },
            { type: "null" },
          ],
        },
      },
      required: [
        "afterSeq",
        "afterEventHash",
        "limit",
        "returnedCount",
        "hasMore",
        "nextCursor",
      ],
      additionalProperties: true,
    },
    filter: {
      type: "object",
      properties: {
        eventTypes: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", enum: eventTypes },
        },
      },
      required: ["eventTypes"],
      additionalProperties: true,
    },
    events: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { $ref: eventEnvelopeSchema.$id },
    },
  },
  required: ["schemaVersion", "projectId", "runId", "integrity", "page", "events"],
  additionalProperties: true,
} as const;

export type TracePageReport = FromSchema<
  typeof tracePageReportSchema,
  { references: [typeof eventEnvelopeSchema] }
>;
