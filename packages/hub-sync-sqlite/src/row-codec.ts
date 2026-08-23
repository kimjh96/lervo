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
    throw new HubSyncStoreError("integrity_failed", "The Hub sync SQLite row format is invalid.");
  }
  return value;
}

export function nullableStringField(row: SQLiteRow, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new HubSyncStoreError("integrity_failed", "The Hub sync SQLite row format is invalid.");
  }
  return value;
}

export function integerField(row: SQLiteRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HubSyncStoreError("integrity_failed", "The Hub sync SQLite row format is invalid.");
  }
  return value;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub sync SQLite JSON source cannot be read.",
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
      "The Hub sync SQLite registration source is invalid.",
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
      "The duplicate Hub sync SQLite project coordinates differ from the registration source.",
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
    throw new HubSyncStoreError("integrity_failed", "The Hub sync SQLite cursor is invalid.");
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
      "The Hub sync SQLite event source is invalid.",
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
      "The duplicate Hub sync SQLite event coordinates differ from the event source.",
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
      "The Hub sync SQLite source differs from the project sync contract.",
      { cause: error },
    );
  }
  return structuredClone(state);
}
