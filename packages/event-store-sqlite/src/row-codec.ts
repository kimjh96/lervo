import { type SQLOutputValue } from "node:sqlite";

import { assertReadableEventEnvelope, EventContractError } from "@lervo/event-contract";
import { type EventEnvelope } from "@lervo/schemas";

import { EventStoreError } from "./errors.js";

export type SqliteRow = Record<string, SQLOutputValue>;

export function requireString(row: SqliteRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new EventStoreError("integrity_failed", `SQLite event ${key} is not a string.`);
  }
  return value;
}

function requireNumber(row: SqliteRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new EventStoreError("integrity_failed", `SQLite event ${key} is not a safe integer.`);
  }
  return value;
}

function parseJsonObject(value: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new EventStoreError("integrity_failed", `${field} JSON cannot be read.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EventStoreError("integrity_failed", `${field} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function rowToEvent(row: SqliteRow): EventEnvelope {
  const previousHash = row.previous_hash;
  if (previousHash !== null && typeof previousHash !== "string") {
    throw new EventStoreError("integrity_failed", "The previous_hash format is invalid.");
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
  try {
    assertReadableEventEnvelope(candidate);
  } catch (error) {
    if (error instanceof EventContractError && error.code === "event_schema_unsupported") {
      throw new EventStoreError("event_schema_unsupported", error.message);
    }
    throw new EventStoreError(
      "integrity_failed",
      "The stored event does not satisfy a readable event schema.",
    );
  }
  return candidate;
}
