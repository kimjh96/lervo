import { validateSchema, type EventReaderCapabilities } from "@lervo/schemas";

import { readableEventSchemaVersions } from "./event-schema-versions.js";

export type EventReaderCapabilitiesErrorCode =
  "event_reader_capabilities_invalid" | "event_reader_capabilities_schema_unsupported";

export class EventReaderCapabilitiesError extends Error {
  constructor(
    readonly code: EventReaderCapabilitiesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventReaderCapabilitiesError";
  }
}

function capabilitiesSchemaVersion(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as { schemaVersion?: unknown }).schemaVersion
    : undefined;
}

export function readEventReaderCapabilities(value: unknown): EventReaderCapabilities {
  const schemaVersion = capabilitiesSchemaVersion(value);
  if (typeof schemaVersion === "number" && Number.isInteger(schemaVersion) && schemaVersion !== 1) {
    throw new EventReaderCapabilitiesError(
      "event_reader_capabilities_schema_unsupported",
      `Event reader capabilities schema version ${schemaVersion} is not supported.`,
    );
  }
  const validation = validateSchema("eventReaderCapabilities", value);
  if (!validation.valid) {
    throw new EventReaderCapabilitiesError(
      "event_reader_capabilities_invalid",
      "The event reader capabilities report is invalid.",
    );
  }
  const report = value as EventReaderCapabilities;
  const versions = report.readableEventSchemaVersions;
  if (versions.some((version, index) => index > 0 && versions[index - 1]! >= version)) {
    throw new EventReaderCapabilitiesError(
      "event_reader_capabilities_invalid",
      "The event reader capabilities versions must be strictly ascending.",
    );
  }
  return structuredClone(report);
}

export function createEventReaderCapabilities(): EventReaderCapabilities {
  return readEventReaderCapabilities({
    schemaVersion: 1,
    capability: "event_reader",
    readableEventSchemaVersions: [...readableEventSchemaVersions],
  });
}
