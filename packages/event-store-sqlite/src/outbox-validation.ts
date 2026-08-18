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
      `${field}는 공백 없는 안전한 식별자여야 합니다.`,
    );
  }
  return value;
}

export function requireOutboxTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !timezonePattern.test(value)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field}는 유효한 ISO 8601 시각이어야 합니다.`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new EventStoreError(
      "invalid_outbox_request",
      `${field}는 유효한 ISO 8601 시각이어야 합니다.`,
    );
  }
  return new Date(milliseconds).toISOString();
}

export function requireStoredOutboxTimestamp(value: string, field: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new EventStoreError(
      "integrity_failed",
      `outbox의 ${field}가 정규화된 ISO 8601 시각이 아닙니다.`,
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
      `${field}는 1 이상 ${maximum} 이하의 안전한 정수여야 합니다.`,
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
      "failureCode는 비밀정보가 아닌 짧은 기계용 코드여야 합니다.",
    );
  }
  return value;
}
