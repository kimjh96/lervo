import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { type HubProjectCoordinate } from "@lervo/hub-sync";
import { type ProjectSyncState } from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { PROJECT_COLUMNS } from "./project-head.js";
import { decodeProjectState, integerField, stringField } from "./row-codec.js";

export class HubAuditSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  healthCounts(): { projectCount: number; eventCount: number } {
    return {
      projectCount: this.metaCount("project_count"),
      eventCount: this.metaCount("event_count"),
    };
  }

  assertGlobalCounts(projectCount: number, eventCount: number): void {
    const metadata = this.healthCounts();
    if (metadata.projectCount !== projectCount || metadata.eventCount !== eventCount) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub global count differs from the source.",
      );
    }
  }

  private metaCount(key: "project_count" | "event_count"): number {
    const value = this.database
      .prepare("SELECT value FROM hub_sync_meta WHERE key = ?")
      .get(key)?.value;
    const count = typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new HubSyncStoreError("integrity_failed", "The Hub count metadata is invalid.");
    }
    return count;
  }

  listProjectCoordinates(): HubProjectCoordinate[] {
    return this.database
      .prepare(
        `
      SELECT destination_id, project_id
      FROM hub_projects
      ORDER BY destination_id ASC, project_id ASC
    `,
      )
      .all()
      .map((row) => ({
        destinationId: stringField(row, "destination_id"),
        projectId: stringField(row, "project_id"),
      }));
  }

  loadProject(coordinate: HubProjectCoordinate): ProjectSyncState | null {
    const projectRow = this.database
      .prepare(
        `
      SELECT ${PROJECT_COLUMNS}, stored_event_count, run_count
      FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `,
      )
      .get(coordinate.destinationId, coordinate.projectId);
    if (projectRow === undefined) return null;
    const eventRows = this.database
      .prepare(
        `
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ?
      ORDER BY seq ASC
    `,
      )
      .all(coordinate.destinationId, coordinate.projectId);
    const state = decodeProjectState(projectRow, eventRows);
    this.assertDerivedIndexes(coordinate, projectRow, state);
    return state;
  }

  private assertDerivedIndexes(
    coordinate: HubProjectCoordinate,
    projectRow: Record<string, unknown>,
    state: ProjectSyncState,
  ): void {
    const expectedRuns = new Map<
      string,
      {
        firstSeq: number;
        lastSeq: number;
        eventCount: number;
        continuousEventCount: number;
        sessions: Map<string, number>;
      }
    >();
    for (const event of state.events) {
      const run = expectedRuns.get(event.runId) ?? {
        firstSeq: event.seq,
        lastSeq: event.seq,
        eventCount: 0,
        continuousEventCount: 0,
        sessions: new Map<string, number>(),
      };
      run.firstSeq = Math.min(run.firstSeq, event.seq);
      run.lastSeq = Math.max(run.lastSeq, event.seq);
      run.eventCount += 1;
      if (event.seq <= state.cursor.seq) run.continuousEventCount += 1;
      run.sessions.set(
        event.sessionId,
        Math.min(run.sessions.get(event.sessionId) ?? event.seq, event.seq),
      );
      expectedRuns.set(event.runId, run);
    }
    if (
      integerField(projectRow, "stored_event_count") !== state.events.length ||
      integerField(projectRow, "run_count") !== expectedRuns.size
    ) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The derived Hub project count differs from the source events.",
      );
    }
    const storedRuns = this.database
      .prepare(
        `
      SELECT run_id, first_seq, last_seq, event_count, continuous_event_count
      FROM hub_runs
      WHERE destination_id = ? AND project_id = ?
      ORDER BY run_id ASC
    `,
      )
      .all(coordinate.destinationId, coordinate.projectId)
      .map((row) => ({
        runId: stringField(row, "run_id"),
        firstSeq: integerField(row, "first_seq"),
        lastSeq: integerField(row, "last_seq"),
        eventCount: integerField(row, "event_count"),
        continuousEventCount: integerField(row, "continuous_event_count"),
      }));
    const expectedRunRows = [...expectedRuns.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([runId, run]) => ({
        runId,
        firstSeq: run.firstSeq,
        lastSeq: run.lastSeq,
        eventCount: run.eventCount,
        continuousEventCount: run.continuousEventCount,
      }));
    if (canonicalJson(storedRuns) !== canonicalJson(expectedRunRows)) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The derived Hub run index differs from the source events.",
      );
    }
    const storedSessions = this.database
      .prepare(
        `
      SELECT run_id, session_id, first_seq
      FROM hub_run_sessions
      WHERE destination_id = ? AND project_id = ?
      ORDER BY run_id ASC, session_id ASC
    `,
      )
      .all(coordinate.destinationId, coordinate.projectId)
      .map((row) => ({
        runId: stringField(row, "run_id"),
        sessionId: stringField(row, "session_id"),
        firstSeq: integerField(row, "first_seq"),
      }));
    const expectedSessions = [...expectedRuns.entries()]
      .flatMap(([runId, run]) =>
        [...run.sessions.entries()].map(([sessionId, firstSeq]) => ({
          runId,
          sessionId,
          firstSeq,
        })),
      )
      .sort(
        (left, right) =>
          left.runId.localeCompare(right.runId) || left.sessionId.localeCompare(right.sessionId),
      );
    if (canonicalJson(storedSessions) !== canonicalJson(expectedSessions)) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The derived Hub session index differs from the source events.",
      );
    }
  }
}
