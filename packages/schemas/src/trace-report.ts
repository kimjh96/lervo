import type { FromSchema } from "json-schema-to-ts";

import {
  projectIdSchema,
  runIdSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { eventEnvelopeSchema } from "./event.js";

export const traceReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/trace-report.schema.json",
  title: "Lervo trace report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    projectId: projectIdSchema,
    runId: runIdSchema,
    status: {
      type: "string",
      enum: ["completed", "failed", "incomplete"],
    },
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
    firstOccurredAt: timestampSchema,
    lastOccurredAt: timestampSchema,
    sessionIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: sessionIdSchema,
    },
    events: {
      type: "array",
      minItems: 1,
      items: { $ref: eventEnvelopeSchema.$id },
    },
  },
  required: [
    "schemaVersion",
    "projectId",
    "runId",
    "status",
    "integrity",
    "firstOccurredAt",
    "lastOccurredAt",
    "sessionIds",
    "events",
  ],
  additionalProperties: true,
} as const;

export type TraceReport = FromSchema<
  typeof traceReportSchema,
  { references: [typeof eventEnvelopeSchema] }
>;
