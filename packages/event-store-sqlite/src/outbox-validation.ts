import { EventStoreError } from "./errors.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const failureCodePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const timezonePattern = /(?:Z|[+-]\d{2}:\d{2})$/;

export function isOutboxIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

export function requireOutboxIdentifier(value: unknown, field: string): string {
  if (!isOutboxIdentifier(value)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field} must be a safe identifier without whitespace.`,
    );
  }
  return value;
}

export function requireOutboxTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !timezonePattern.test(value)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field} must be a valid ISO 8601 time.`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field} must be a valid ISO 8601 time.`,
    );
  }
  return new Date(milliseconds).toISOString();
}

export function requireStoredOutboxTimestamp(value: string, field: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new EventStoreError(
      "integrity_failed",
      `Outbox ${field} is not a normalized ISO 8601 time.`,
    );
  }
  return value;
}

export function requireOutboxPositiveInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field} must be a safe integer between 1 and ${maximum}.`,
    );
  }
  return value;
}

export function isOutboxFailureCode(value: unknown): value is string {
  return typeof value === "string" && failureCodePattern.test(value);
}

export function requireOutboxFailureCode(value: unknown): string {
  if (!isOutboxFailureCode(value)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      "failureCode must be a short machine-readable code without secret information.",
    );
  }
  return value;
}
