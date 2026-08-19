import { type DatabaseSync } from "node:sqlite";

import { type HubProjectCoordinate } from "@lervo/hub-sync";
import { type EventEnvelope } from "@lervo/schemas";

import { integerField, stringField } from "./row-codec.js";

export class HubTraceIndexSQLiteWriter {
  constructor(private readonly database: DatabaseSync) {}

  addEvents(coordinate: HubProjectCoordinate, events: readonly EventEnvelope[]): number {
    const insertRun = this.database.prepare(`
      INSERT OR IGNORE INTO hub_runs (
        destination_id, project_id, run_id, first_seq, last_seq,
        event_count, continuous_event_count
      ) VALUES (?, ?, ?, ?, ?, 1, 0)
    `);
    const updateRun = this.database.prepare(`
      UPDATE hub_runs
      SET first_seq = MIN(first_seq, ?), last_seq = MAX(last_seq, ?),
          event_count = event_count + 1
      WHERE destination_id = ? AND project_id = ? AND run_id = ?
    `);
    const insertSession = this.database.prepare(`
      INSERT OR IGNORE INTO hub_run_sessions (
        destination_id, project_id, run_id, session_id, first_seq
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const updateSession = this.database.prepare(`
      UPDATE hub_run_sessions SET first_seq = MIN(first_seq, ?)
      WHERE destination_id = ? AND project_id = ? AND run_id = ? AND session_id = ?
    `);
    let addedRunCount = 0;
    for (const event of events) {
      const inserted = insertRun.run(
        coordinate.destinationId,
        coordinate.projectId,
        event.runId,
        event.seq,
        event.seq,
      ).changes === 1;
      if (inserted) {
        addedRunCount += 1;
      } else {
        updateRun.run(
          event.seq,
          event.seq,
          coordinate.destinationId,
          coordinate.projectId,
          event.runId,
        );
      }
      const sessionInserted = insertSession.run(
        coordinate.destinationId,
        coordinate.projectId,
        event.runId,
        event.sessionId,
        event.seq,
      ).changes === 1;
      if (!sessionInserted) {
        updateSession.run(
          event.seq,
          coordinate.destinationId,
          coordinate.projectId,
          event.runId,
          event.sessionId,
        );
      }
    }
    return addedRunCount;
  }

  advanceContinuousCounts(
    coordinate: HubProjectCoordinate,
    previousCursorSeq: number,
    nextCursorSeq: number,
  ): void {
    if (nextCursorSeq <= previousCursorSeq) return;
    const rows = this.database.prepare(`
      SELECT json_extract(event_json, '$.runId') AS run_id, COUNT(*) AS added_count
      FROM hub_events
      WHERE destination_id = ? AND project_id = ? AND seq > ? AND seq <= ?
      GROUP BY json_extract(event_json, '$.runId')
    `).all(
      coordinate.destinationId,
      coordinate.projectId,
      previousCursorSeq,
      nextCursorSeq,
    );
    const update = this.database.prepare(`
      UPDATE hub_runs
      SET continuous_event_count = continuous_event_count + ?
      WHERE destination_id = ? AND project_id = ? AND run_id = ?
    `);
    for (const row of rows) {
      update.run(
        integerField(row, "added_count"),
        coordinate.destinationId,
        coordinate.projectId,
        stringField(row, "run_id"),
      );
    }
  }
}
