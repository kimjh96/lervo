import { type SQLOutputValue } from "node:sqlite";

import { type EventEnvelope, validateSchema } from "@roven/schemas";

import { EventStoreError } from "./errors.js";

export type SqliteRow = Record<string, SQLOutputValue>;

export function requireString(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new EventStoreError("integrity_failed", `SQLite event의 ${key}가 문자열이 아닙니다.`);
  }
  return value;
}

function requireNumber(row: SqliteRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EventStoreError("integrity_failed", `SQLite event의 ${key}가 안전한 정수가 아닙니다.`);
  }
  return value;
}

function parseJsonObject(value: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new EventStoreError("integrity_failed", `${field} JSON을 읽을 수 없습니다.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EventStoreError("integrity_failed", `${field}는 JSON 객체여야 합니다.`);
  }
  return parsed as Record<string, unknown>;
}

export function rowToEvent(row: SqliteRow): EventEnvelope {
  const previousHash = row.previous_hash;
  if (previousHash !== null && typeof previousHash !== "string") {
    throw new EventStoreError("integrity_failed", "previous_hash 형식이 잘못되었습니다.");
  }
  const candidate = {
    eventId: requireString(row, "event_id"),
    projectId: requireString(row, "project_id"),
    runId: requireString(row, "run_id"),
    sessionId: requireString(row, "session_id"),
    seq: requireNumber(row, "seq"),
    type: requireString(row, "type"),
    occurredAt: requireString(row, "occurred_at"),
    actor: parseJsonObject(requireString(row, "actor_json"), "actor"),
    schemaVersion: requireNumber(row, "schema_version"),
    policyVersion: requireString(row, "policy_version"),
    payload: parseJsonObject(requireString(row, "payload_json"), "payload"),
    previousHash,
    eventHash: requireString(row, "event_hash"),
  };
  const validation = validateSchema("event", candidate);
  if (!validation.valid) {
    throw new EventStoreError(
      "integrity_failed",
      `저장된 event가 schema에 맞지 않습니다: ${validation.errors
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ")}`,
    );
  }
  return candidate as EventEnvelope;
}
