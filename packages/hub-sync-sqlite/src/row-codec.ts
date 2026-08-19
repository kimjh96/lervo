import { type EventEnvelope, type ProjectRegistrationRequest } from "@lervo/schemas";
import {
  assertProjectRegistrationRequest,
  assertProjectSyncState,
  assertSyncableEvent,
  type ProjectRegistrationRecord,
  type ProjectSyncState,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";

export type SQLiteRow = Record<string, unknown>;

export function stringField(row: SQLiteRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

export function nullableStringField(row: SQLiteRow, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

export function integerField(row: SQLiteRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite JSON 원본을 읽을 수 없습니다.",
      { cause: error },
    );
  }
}

export interface ProjectHead {
  registration: ProjectRegistrationRecord;
  cursor: ProjectSyncState["cursor"];
}

export function decodeProjectHead(projectRow: SQLiteRow): ProjectHead {
  const request = parseJson(stringField(projectRow, "request_json")) as ProjectRegistrationRequest;
  try {
    assertProjectRegistrationRequest(request);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite registration 원본이 유효하지 않습니다.",
      { cause: error },
    );
  }
  if (
    request.destinationId !== stringField(projectRow, "destination_id") ||
    request.project.projectId !== stringField(projectRow, "project_id") ||
    request.registrationId !== stringField(projectRow, "registration_id") ||
    request.projectIdentityHash !== stringField(projectRow, "identity_hash") ||
    request.projectManifestHash !== stringField(projectRow, "manifest_hash")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite의 중복 project 좌표가 registration 원본과 다릅니다.",
    );
  }
  const cursor = {
    seq: integerField(projectRow, "cursor_seq"),
    eventHash: nullableStringField(projectRow, "cursor_hash"),
  } as ProjectSyncState["cursor"];
  if (
    cursor.seq < 0 ||
    (cursor.seq === 0 ? cursor.eventHash !== null : cursor.eventHash === null)
  ) {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite cursor가 유효하지 않습니다.");
  }
  return {
    registration: {
      request: structuredClone(request),
      registeredAt: stringField(projectRow, "registered_at"),
      updatedAt: stringField(projectRow, "updated_at"),
    },
    cursor: structuredClone(cursor),
  };
}

export function decodeStoredEvent(row: SQLiteRow): EventEnvelope {
  const event = parseJson(stringField(row, "event_json")) as EventEnvelope;
  try {
    assertSyncableEvent(event);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite event 원본이 유효하지 않습니다.",
      { cause: error },
    );
  }
  if (
    event.seq !== integerField(row, "seq") ||
    event.eventId !== stringField(row, "event_id") ||
    event.eventHash !== stringField(row, "event_hash") ||
    event.previousHash !== nullableStringField(row, "previous_hash")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite의 중복 event 좌표가 event 원본과 다릅니다.",
    );
  }
  return structuredClone(event);
}

export function decodeProjectState(
  projectRow: SQLiteRow,
  eventRows: readonly SQLiteRow[],
): ProjectSyncState {
  const head = decodeProjectHead(projectRow);
  const state: ProjectSyncState = {
    ...head,
    events: eventRows.map(decodeStoredEvent),
  };
  try {
    assertProjectSyncState(state);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite 원본이 project sync 계약과 다릅니다.",
      { cause: error },
    );
  }
  return structuredClone(state);
}
