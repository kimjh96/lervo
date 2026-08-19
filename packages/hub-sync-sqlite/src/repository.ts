import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { type HubProjectCoordinate } from "@lervo/hub-sync";
import {
  assertProjectSyncState,
  type ProjectSyncState,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { decodeProjectState } from "./row-codec.js";

export class HubSyncSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  loadProject(coordinate: HubProjectCoordinate): ProjectSyncState | null {
    const projectRow = this.database.prepare(`
      SELECT destination_id, project_id, registration_id, identity_hash, manifest_hash,
             request_json, registered_at, updated_at, cursor_seq, cursor_hash
      FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `).get(coordinate.destinationId, coordinate.projectId);
    if (projectRow === undefined) return null;
    const eventRows = this.database.prepare(`
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ?
      ORDER BY seq ASC
    `).all(coordinate.destinationId, coordinate.projectId);
    return decodeProjectState(projectRow, eventRows);
  }

  listProjectCoordinates(): HubProjectCoordinate[] {
    return this.database.prepare(`
      SELECT destination_id, project_id
      FROM hub_projects
      ORDER BY destination_id ASC, project_id ASC
    `).all().map((row) => {
      if (typeof row.destination_id !== "string" || typeof row.project_id !== "string") {
        throw new HubSyncStoreError(
          "integrity_failed",
          "Hub sync SQLite project 좌표가 유효하지 않습니다.",
        );
      }
      return { destinationId: row.destination_id, projectId: row.project_id };
    });
  }

  saveProject(next: ProjectSyncState): void {
    assertProjectSyncState(next);
    const request = next.registration.request;
    const coordinate = {
      destinationId: request.destinationId,
      projectId: request.project.projectId,
    };
    const current = this.loadProject(coordinate);
    this.assertAppendOnlyTransition(current, next);

    if (current === null) {
      this.database.prepare(`
        INSERT INTO hub_projects (
          destination_id, project_id, registration_id, identity_hash, manifest_hash,
          request_json, registered_at, updated_at, cursor_seq, cursor_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        coordinate.destinationId,
        coordinate.projectId,
        request.registrationId,
        request.projectIdentityHash,
        request.projectManifestHash,
        canonicalJson(request),
        next.registration.registeredAt,
        next.registration.updatedAt,
        next.cursor.seq,
        next.cursor.eventHash,
      );
    }

    const existingIds = new Set(current?.events.map((event) => event.eventId) ?? []);
    const insertEvent = this.database.prepare(`
      INSERT INTO hub_events (
        destination_id, project_id, seq, event_id, event_hash, previous_hash, event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of next.events) {
      if (existingIds.has(event.eventId)) continue;
      insertEvent.run(
        coordinate.destinationId,
        coordinate.projectId,
        event.seq,
        event.eventId,
        event.eventHash,
        event.previousHash,
        canonicalJson(event),
      );
    }

    if (current !== null) {
      this.database.prepare(`
        UPDATE hub_projects
        SET registration_id = ?, identity_hash = ?, manifest_hash = ?, request_json = ?,
            registered_at = ?, updated_at = ?, cursor_seq = ?, cursor_hash = ?
        WHERE destination_id = ? AND project_id = ?
      `).run(
        request.registrationId,
        request.projectIdentityHash,
        request.projectManifestHash,
        canonicalJson(request),
        next.registration.registeredAt,
        next.registration.updatedAt,
        next.cursor.seq,
        next.cursor.eventHash,
        coordinate.destinationId,
        coordinate.projectId,
      );
    }

    const stored = this.loadProject(coordinate);
    if (stored === null || canonicalJson(stored) !== canonicalJson(next)) {
      throw new HubSyncStoreError(
        "write_failed",
        "Hub sync SQLite에 저장한 state를 같은 transaction에서 확인하지 못했습니다.",
      );
    }
  }

  private assertAppendOnlyTransition(
    current: ProjectSyncState | null,
    next: ProjectSyncState,
  ): void {
    if (current === null) return;
    if (
      current.registration.request.projectIdentityHash !==
        next.registration.request.projectIdentityHash ||
      current.registration.registeredAt !== next.registration.registeredAt ||
      next.cursor.seq < current.cursor.seq ||
      next.events.length < current.events.length
    ) {
      throw new HubSyncStoreError(
        "state_conflict",
        "Hub sync project identity, cursor 또는 event 원본을 되돌릴 수 없습니다.",
      );
    }
    const nextById = new Map(next.events.map((event) => [event.eventId, event]));
    if (current.events.some((event) => {
      const nextEvent = nextById.get(event.eventId);
      return nextEvent === undefined || canonicalJson(nextEvent) !== canonicalJson(event);
    })) {
      throw new HubSyncStoreError(
        "state_conflict",
        "Hub sync event 원본을 변경하거나 제거할 수 없습니다.",
      );
    }
  }
}
