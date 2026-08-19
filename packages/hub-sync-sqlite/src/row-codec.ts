import { type EventEnvelope, type ProjectRegistrationRequest } from "@lervo/schemas";
import {
  assertProjectSyncState,
  type ProjectSyncState,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";

type Row = Record<string, unknown>;

function stringField(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

function nullableStringField(row: Row, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

function integerField(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite row 형식이 유효하지 않습니다.");
  }
  return value;
}

function parseJson(value: string): unknown {
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

export function decodeProjectState(projectRow: Row, eventRows: readonly Row[]): ProjectSyncState {
  const events = eventRows.map((row) => {
    const event = parseJson(stringField(row, "event_json")) as EventEnvelope;
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
    return event;
  });
  const state: ProjectSyncState = {
    registration: {
      request: parseJson(stringField(projectRow, "request_json")) as ProjectRegistrationRequest,
      registeredAt: stringField(projectRow, "registered_at"),
      updatedAt: stringField(projectRow, "updated_at"),
    },
    cursor: {
      seq: integerField(projectRow, "cursor_seq"),
      eventHash: nullableStringField(projectRow, "cursor_hash"),
    } as ProjectSyncState["cursor"],
    events,
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
  if (
    state.registration.request.destinationId !== stringField(projectRow, "destination_id") ||
    state.registration.request.project.projectId !== stringField(projectRow, "project_id") ||
    state.registration.request.registrationId !== stringField(projectRow, "registration_id") ||
    state.registration.request.projectIdentityHash !== stringField(projectRow, "identity_hash") ||
    state.registration.request.projectManifestHash !== stringField(projectRow, "manifest_hash")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub sync SQLite의 중복 project 좌표가 registration 원본과 다릅니다.",
    );
  }
  return structuredClone(state);
}
