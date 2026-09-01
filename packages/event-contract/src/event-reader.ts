import { validateSchema, type EventEnvelope } from "@lervo/schemas";

export const readableEventSchemaVersions = [1, 2] as const;
export const writableEventSchemaVersion = 1 as const;

export type EventContractErrorCode = "event_invalid" | "event_schema_unsupported";

export class EventContractError extends Error {
  constructor(
    readonly code: EventContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventContractError";
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
