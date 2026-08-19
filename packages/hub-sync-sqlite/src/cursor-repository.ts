import { type DatabaseSync } from "node:sqlite";

import { type HubProjectCoordinate } from "@lervo/hub-sync";
import { type EventEnvelope } from "@lervo/schemas";
import { SyncContractError, type ProjectSyncState } from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { decodeStoredEvent, integerField } from "./row-codec.js";

export class HubCursorSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  eventAt(coordinate: HubProjectCoordinate, seq: number): EventEnvelope | undefined {
    const row = this.database.prepare(`
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ? AND seq = ?
    `).get(coordinate.destinationId, coordinate.projectId, seq);
    return row === undefined ? undefined : decodeStoredEvent(row);
  }

  nextCursor(
    coordinate: HubProjectCoordinate,
    current: ProjectSyncState["cursor"],
  ): ProjectSyncState["cursor"] {
    const first = this.eventAt(coordinate, current.seq + 1);
    if (first === undefined) return structuredClone(current);
    if (first.previousHash !== current.eventHash) {
      throw new SyncContractError(
        "event_chain_conflict",
        "Hub cursor 다음 event가 현재 hash chain과 연결되지 않습니다.",
      );
    }
    const firstAfterGap = this.database.prepare(`
      SELECT MIN(event.seq) AS first_after_gap
      FROM hub_events AS event
      LEFT JOIN hub_events AS previous
        ON previous.destination_id = event.destination_id
       AND previous.project_id = event.project_id
       AND previous.seq = event.seq - 1
      WHERE event.destination_id = ? AND event.project_id = ?
        AND event.seq > ? AND previous.seq IS NULL
    `).get(coordinate.destinationId, coordinate.projectId, current.seq + 1)?.first_after_gap;
    const lastSeq = this.lastContinuousSeq(coordinate, current.seq, firstAfterGap);
    const last = this.eventAt(coordinate, lastSeq);
    if (last === undefined) {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite cursor event가 없습니다.");
    }
    return { seq: last.seq, eventHash: last.eventHash };
  }

  countEventsAfter(coordinate: HubProjectCoordinate, seq: number): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS event_count
      FROM hub_events
      WHERE destination_id = ? AND project_id = ? AND seq > ?
    `).get(coordinate.destinationId, coordinate.projectId, seq);
    if (row === undefined) {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite event 수를 읽을 수 없습니다.");
    }
    return integerField(row, "event_count");
  }

  private lastContinuousSeq(
    coordinate: HubProjectCoordinate,
    currentSeq: number,
    firstAfterGap: unknown,
  ): number {
    if (typeof firstAfterGap === "number" && Number.isSafeInteger(firstAfterGap)) {
      return firstAfterGap - 2;
    }
    if (firstAfterGap !== null && firstAfterGap !== undefined) {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite gap 좌표가 유효하지 않습니다.");
    }
    const maximum = this.database.prepare(`
      SELECT MAX(seq) AS maximum_seq
      FROM hub_events
      WHERE destination_id = ? AND project_id = ?
    `).get(coordinate.destinationId, coordinate.projectId);
    return maximum === undefined ? currentSeq : integerField(maximum, "maximum_seq");
  }
}
