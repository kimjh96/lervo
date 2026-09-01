import { validateSchema, type EventEnvelope, type EventReaderCapabilities } from "@lervo/schemas";

export const readableEventSchemaVersions = [1, 2] as const;
export const writableEventSchemaVersion = 1 as const;

export type EventContractErrorCode = "event_invalid" | "event_schema_unsupported";

export type EventReaderCapabilitiesErrorCode =
  "event_reader_capabilities_invalid" | "event_reader_capabilities_schema_unsupported";

export class EventContractError extends Error {
  constructor(
    readonly code: EventContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventContractError";
  }
}

export class EventReaderCapabilitiesError extends Error {
  constructor(
    readonly code: EventReaderCapabilitiesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventReaderCapabilitiesError";
  }
}

function eventSchemaVersion(value: unknown): unknown {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as { schemaVersion?: unknown }).schemaVersion
    : undefined;
}

export function assertReadableEventEnvelope(value: unknown): asserts value is EventEnvelope {
  const schemaVersion = eventSchemaVersion(value);
  if (
    typeof schemaVersion === "number" &&
    Number.isInteger(schemaVersion) &&
    !readableEventSchemaVersions.includes(schemaVersion as 1 | 2)
  ) {
    throw new EventContractError(
      "event_schema_unsupported",
      `Event schema version ${schemaVersion} is not supported by this reader.`,
    );
  }
  const validation = validateSchema("event", value);
  if (!validation.valid) {
    throw new EventContractError(
      "event_invalid",
      validation.errors
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; "),
    );
  }
}

export function readEventEnvelope(value: unknown): EventEnvelope {
  assertReadableEventEnvelope(value);
  return structuredClone(value);
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
