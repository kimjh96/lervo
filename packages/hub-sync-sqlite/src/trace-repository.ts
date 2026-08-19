import { type DatabaseSync } from "node:sqlite";

import {
  type HubEventTraceCursor,
  type HubProjectTrace,
  type HubProjectTraceSummary,
  type HubRunTrace,
  type HubRunTraceEvent,
  type HubRunTraceSummary,
  type HubTracePage,
  type ResolvedHubProjectRunQuery,
  type ResolvedHubProjectTraceQuery,
  type ResolvedHubRunEventQuery,
} from "@lervo/hub-trace";

import { HubSyncStoreError } from "./errors.js";
import {
  decodeProjectHead,
  decodeStoredEvent,
  integerField,
  type SQLiteRow,
  stringField,
} from "./row-codec.js";

const PROJECT_COLUMNS = `
  project.destination_id, project.project_id, project.registration_id,
  project.identity_hash, project.manifest_hash, project.request_json,
  project.registered_at, project.updated_at, project.cursor_seq, project.cursor_hash
`;
const MAX_SUMMARY_SESSION_IDS = 16;

function page<T, Cursor>(
  items: T[],
  limit: number,
  cursor: (item: T) => Cursor,
): HubTracePage<T, Cursor> {
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items,
    nextCursor: hasMore && items.length !== 0 ? cursor(items.at(-1)!) : null,
  };
}

function projectSummary(row: SQLiteRow): HubProjectTraceSummary {
  const head = decodeProjectHead(row);
  const request = head.registration.request;
  const storedEventCount = integerField(row, "stored_event_count");
  const runCount = integerField(row, "run_count");
  if (storedEventCount < head.cursor.seq || runCount < 0) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "Hub trace project 집계가 cursor와 일치하지 않습니다.",
    );
  }
  return {
    destinationId: request.destinationId,
    projectId: request.project.projectId,
    projectName: request.project.name,
    registrationId: request.registrationId,
    projectIdentityHash: request.projectIdentityHash,
    projectManifestHash: request.projectManifestHash,
    registeredAt: head.registration.registeredAt,
    updatedAt: head.registration.updatedAt,
    cursor: structuredClone(head.cursor),
    storedEventCount,
    continuousEventCount: head.cursor.seq,
    bufferedEventCount: storedEventCount - head.cursor.seq,
    runCount,
  };
}

export class HubTraceSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  listProjects(
    query: ResolvedHubProjectTraceQuery,
  ): HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }> {
    const after = query.after;
    const rows = this.database.prepare(`
      SELECT ${PROJECT_COLUMNS},
        project.stored_event_count, project.run_count
      FROM hub_projects AS project
      WHERE (? IS NULL OR project.destination_id > ? OR
        (project.destination_id = ? AND project.project_id > ?))
      ORDER BY project.destination_id ASC, project.project_id ASC
      LIMIT ?
    `).all(
      after?.destinationId ?? null,
      after?.destinationId ?? null,
      after?.destinationId ?? null,
      after?.projectId ?? null,
      query.limit + 1,
    );
    return page(rows.map(projectSummary), query.limit, (item) => ({
      destinationId: item.destinationId,
      projectId: item.projectId,
    }));
  }

  getProject(query: ResolvedHubProjectRunQuery): HubProjectTrace | null {
    const project = this.readProjectSummary(query.destinationId, query.projectId);
    if (project === null) return null;
    const afterFirstSeq = query.after?.firstSeq ?? null;
    const afterRunId = query.after?.runId ?? null;
    const rows = this.database.prepare(`
      SELECT run_id, first_seq, last_seq, event_count, continuous_event_count
      FROM hub_runs
      WHERE destination_id = ? AND project_id = ?
        AND (? IS NULL OR first_seq > ? OR (first_seq = ? AND run_id > ?))
      ORDER BY first_seq ASC, run_id ASC
      LIMIT ?
    `).all(
      query.destinationId,
      query.projectId,
      afterFirstSeq,
      afterFirstSeq,
      afterFirstSeq,
      afterRunId,
      query.limit + 1,
    );
    const summaries = rows.map((row) => this.runSummary(query.destinationId, query.projectId, row));
    return {
      project,
      runs: page(summaries, query.limit, (item) => ({
        firstSeq: item.firstSeq,
        runId: item.runId,
      })),
    };
  }

  getRun(query: ResolvedHubRunEventQuery): HubRunTrace | null {
    const project = this.readProjectSummary(query.destinationId, query.projectId);
    if (project === null) return null;
    const aggregate = this.database.prepare(`
      SELECT run_id, first_seq, last_seq, event_count, continuous_event_count
      FROM hub_runs
      WHERE destination_id = ? AND project_id = ?
        AND run_id = ?
    `).get(query.destinationId, query.projectId, query.runId);
    if (aggregate === undefined) return null;
    const run = this.runSummary(query.destinationId, query.projectId, aggregate);
    const rows = this.database.prepare(`
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ?
        AND json_extract(event_json, '$.runId') = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(
      query.destinationId,
      query.projectId,
      query.runId,
      query.after?.seq ?? 0,
      query.limit + 1,
    );
    const events: HubRunTraceEvent[] = rows.map((row) => {
      const event = decodeStoredEvent(row);
      return {
        chainPosition: event.seq <= project.cursor.seq ? "continuous" : "buffered",
        event,
      };
    });
    return {
      project,
      run,
      events: page<HubRunTraceEvent, HubEventTraceCursor>(events, query.limit, (item) => ({
        seq: item.event.seq,
      })),
    };
  }

  private readProjectSummary(
    destinationId: string,
    projectId: string,
  ): HubProjectTraceSummary | null {
    const row = this.database.prepare(`
      SELECT ${PROJECT_COLUMNS},
        project.stored_event_count, project.run_count
      FROM hub_projects AS project
      WHERE project.destination_id = ? AND project.project_id = ?
    `).get(destinationId, projectId);
    return row === undefined ? null : projectSummary(row);
  }

  private runSummary(
    destinationId: string,
    projectId: string,
    row: SQLiteRow,
  ): HubRunTraceSummary {
    const runId = stringField(row, "run_id");
    const firstSeq = integerField(row, "first_seq");
    const lastSeq = integerField(row, "last_seq");
    const eventCount = integerField(row, "event_count");
    const continuousEventCount = integerField(row, "continuous_event_count");
    const boundaryRows = this.database.prepare(`
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ? AND seq IN (?, ?)
      ORDER BY seq ASC
    `).all(destinationId, projectId, firstSeq, lastSeq).map(decodeStoredEvent);
    const first = boundaryRows[0];
    const last = boundaryRows.at(-1);
    if (first === undefined || last === undefined || first.runId !== runId || last.runId !== runId) {
      throw new HubSyncStoreError("integrity_failed", "Hub trace run 경계가 event 원본과 다릅니다.");
    }
    const sessionRows = this.database.prepare(`
      SELECT session_id, first_seq
      FROM hub_run_sessions
      WHERE destination_id = ? AND project_id = ?
        AND run_id = ?
      ORDER BY first_seq ASC, session_id ASC
      LIMIT ?
    `).all(destinationId, projectId, runId, MAX_SUMMARY_SESSION_IDS);
    const sessionIds = sessionRows.map((session) => stringField(session, "session_id"));
    const sessionCountRow = this.database.prepare(`
      SELECT COUNT(*) AS session_count
      FROM hub_run_sessions
      WHERE destination_id = ? AND project_id = ?
        AND run_id = ?
    `).get(destinationId, projectId, runId);
    if (sessionCountRow === undefined) {
      throw new HubSyncStoreError("integrity_failed", "Hub trace session 수를 읽을 수 없습니다.");
    }
    const sessionCount = integerField(sessionCountRow, "session_count");
    return {
      runId,
      sessionIds,
      sessionCount,
      sessionIdsTruncated: sessionCount > sessionIds.length,
      firstSeq,
      lastSeq,
      firstOccurredAt: first.occurredAt,
      lastOccurredAt: last.occurredAt,
      eventCount,
      continuousEventCount,
      bufferedEventCount: eventCount - continuousEventCount,
    };
  }
}
