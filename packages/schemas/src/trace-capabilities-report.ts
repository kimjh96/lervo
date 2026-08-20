import type { FromSchema } from "json-schema-to-ts";

const traceModeSchema = {
  type: "string",
  enum: ["implicit_full", "full", "page", "cursor"],
} as const;

export const traceCapabilitiesReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/trace-capabilities-report.schema.json",
  title: "Lervo trace capabilities report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    capability: { type: "string", const: "trace" },
    defaultMode: traceModeSchema,
    modes: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          mode: traceModeSchema,
          explicit: { type: "boolean" },
          reportKind: { type: "string", enum: ["full", "page"] },
          reportSchemaVersion: { type: "integer", minimum: 1 },
          eventTypeFilter: { type: "boolean" },
          cursorContinuation: { type: "boolean" },
        },
        required: [
          "mode",
          "explicit",
          "reportKind",
          "reportSchemaVersion",
          "eventTypeFilter",
          "cursorContinuation",
        ],
        additionalProperties: true,
      },
    },
    limits: {
      type: "object",
      properties: {
        defaultPageSize: { type: "integer", minimum: 1 },
        maximumPageSize: { type: "integer", minimum: 1 },
        maximumFullEventCount: { type: "integer", minimum: 1 },
        maximumCursorBytes: { type: "integer", minimum: 1 },
      },
      required: [
        "defaultPageSize",
        "maximumPageSize",
        "maximumFullEventCount",
        "maximumCursorBytes",
      ],
      additionalProperties: true,
    },
    deprecations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", pattern: "^[a-z][a-z0-9_]{2,127}$" },
          mode: traceModeSchema,
          replacementMode: traceModeSchema,
          changesIn: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)$",
          },
          nextDefaultMode: traceModeSchema,
        },
        required: ["code", "mode", "replacementMode", "changesIn", "nextDefaultMode"],
        additionalProperties: true,
      },
    },
  },
  required: ["schemaVersion", "capability", "defaultMode", "modes", "limits", "deprecations"],
  additionalProperties: true,
} as const;

export type TraceCapabilitiesReport = FromSchema<typeof traceCapabilitiesReportSchema>;
