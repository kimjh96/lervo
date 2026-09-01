import type { FromSchema } from "json-schema-to-ts";

export const eventReaderCapabilitiesValueSchema = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    capability: { type: "string", const: "event_reader" },
    readableEventSchemaVersions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      items: { type: "integer", minimum: 1, maximum: 255 },
    },
  },
  required: ["schemaVersion", "capability", "readableEventSchemaVersions"],
  additionalProperties: false,
} as const;

export const eventReaderCapabilitiesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event-reader-capabilities.schema.json",
  title: "Lervo event reader capabilities",
  ...eventReaderCapabilitiesValueSchema,
} as const;

export type EventReaderCapabilities = FromSchema<typeof eventReaderCapabilitiesSchema>;
