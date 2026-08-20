import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import { type HubProjectCoordinate } from "@lervo/hub-sync";
import {
  type EventEnvelope,
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
} from "@lervo/schemas";
import {
  assertEventSyncAcknowledgement,
  assertOutboundEventBatch,
  SyncContractError,
} from "@lervo/sync-contract";

import { HubCursorSQLiteRepository } from "./cursor-repository.js";
import { HubSyncStoreError } from "./errors.js";
import { loadProjectHead } from "./project-head.js";
import { decodeStoredEvent } from "./row-codec.js";
import { HubTraceIndexSQLiteWriter } from "./trace-index-writer.js";
import { KnowledgeGraphIndexSQLiteWriter } from "./knowledge-graph-index-writer.js";

function sameEvent(left: EventEnvelope, right: EventEnvelope): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export class HubEventInboxSQLiteRepository {
  private readonly cursor: HubCursorSQLiteRepository;
  private readonly traceIndex: HubTraceIndexSQLiteWriter;
  private readonly knowledgeGraphIndex: KnowledgeGraphIndexSQLiteWriter;

  constructor(private readonly database: DatabaseSync) {
    this.cursor = new HubCursorSQLiteRepository(database);
    this.traceIndex = new HubTraceIndexSQLiteWriter(database);
    this.knowledgeGraphIndex = new KnowledgeGraphIndexSQLiteWriter(database);
  }

  accept(input: {
    batch: OutboundEventBatch;
    acknowledgedAt: string;
  }): EventSyncAcknowledgement {
    assertOutboundEventBatch(input.batch);
    const coordinate = {
      destinationId: input.batch.destinationId,
      projectId: input.batch.projectId,
    };
    const head = loadProjectHead(this.database, coordinate);
    if (
      head === null ||
      head.registration.request.registrationId !== input.batch.registrationId
    ) {
      throw new SyncContractError(
        "registration_required",
        "outbound event batch와 일치하는 project registration이 없습니다.",
      );
    }

    const newEvents: EventEnvelope[] = [];
    let duplicateCount = 0;
    for (const event of input.batch.events) {
      const matches = this.matchingEvents(coordinate, event);
      if (matches.length !== 0) {
        if (matches.length !== 1 || !sameEvent(matches[0]!, event)) {
          throw new SyncContractError(
            "event_chain_conflict",
            "같은 project의 event seq 또는 event ID에 다른 원본이 이미 있습니다.",
          );
        }
        duplicateCount += 1;
      } else {
        this.assertStoredNeighbors(coordinate, event);
        newEvents.push(event);
      }
    }
    this.insertEvents(coordinate, newEvents);

    const cursor = this.cursor.nextCursor(coordinate, head.cursor);
    const addedRunCount = this.traceIndex.addEvents(coordinate, newEvents);
    this.knowledgeGraphIndex.addEvents(coordinate, newEvents);
    this.traceIndex.advanceContinuousCounts(coordinate, head.cursor.seq, cursor.seq);
    this.updateProjectHead(coordinate, cursor, newEvents.length, addedRunCount);
    this.incrementEventCount(newEvents.length);

    const acknowledgement: EventSyncAcknowledgement = {
      schemaVersion: 1,
      batchId: input.batch.batchId,
      registrationId: input.batch.registrationId,
      projectId: input.batch.projectId,
      destinationId: input.batch.destinationId,
      status: newEvents.length === 0 ? "duplicate" : "accepted",
      acceptedEventIds: input.batch.events.map((event) => event.eventId),
      insertedCount: newEvents.length,
      duplicateCount,
      cursor,
      bufferedEventCount: this.cursor.countEventsAfter(coordinate, cursor.seq),
      acknowledgedAt: input.acknowledgedAt,
    };
    assertEventSyncAcknowledgement({ batch: input.batch, acknowledgement });
    return structuredClone(acknowledgement);
  }

  private matchingEvents(
    coordinate: HubProjectCoordinate,
    event: EventEnvelope,
  ): EventEnvelope[] {
    return this.database.prepare(`
      SELECT seq, event_id, event_hash, previous_hash, event_json
      FROM hub_events
      WHERE destination_id = ? AND project_id = ? AND (seq = ? OR event_id = ?)
    `).all(coordinate.destinationId, coordinate.projectId, event.seq, event.eventId)
      .map(decodeStoredEvent);
  }

  private assertStoredNeighbors(coordinate: HubProjectCoordinate, event: EventEnvelope): void {
    const previous = event.seq === 1 ? undefined : this.cursor.eventAt(coordinate, event.seq - 1);
    if (previous !== undefined && event.previousHash !== previous.eventHash) {
      throw new SyncContractError(
        "event_chain_conflict",
        "새 event가 저장된 이전 event hash와 연결되지 않습니다.",
      );
    }
    const next = this.cursor.eventAt(coordinate, event.seq + 1);
    if (next !== undefined && next.previousHash !== event.eventHash) {
      throw new SyncContractError(
        "event_chain_conflict",
        "새 event가 저장된 다음 event hash와 연결되지 않습니다.",
      );
    }
  }

  private insertEvents(coordinate: HubProjectCoordinate, events: readonly EventEnvelope[]): void {
    const insert = this.database.prepare(`
      INSERT INTO hub_events (
        destination_id, project_id, seq, event_id, event_hash, previous_hash, event_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of events) {
      insert.run(
        coordinate.destinationId,
        coordinate.projectId,
        event.seq,
        event.eventId,
        event.eventHash,
        event.previousHash,
        canonicalJson(event),
      );
    }
  }

  private updateProjectHead(
    coordinate: HubProjectCoordinate,
    cursor: { seq: number; eventHash: string | null },
    addedEventCount: number,
    addedRunCount: number,
  ): void {
    this.database.prepare(`
      UPDATE hub_projects
      SET cursor_seq = ?, cursor_hash = ?,
          stored_event_count = stored_event_count + ?,
          run_count = run_count + ?
      WHERE destination_id = ? AND project_id = ?
    `).run(
      cursor.seq,
      cursor.eventHash,
      addedEventCount,
      addedRunCount,
      coordinate.destinationId,
      coordinate.projectId,
    );
  }

  private incrementEventCount(addedEventCount: number): void {
    if (addedEventCount === 0) return;
    const result = this.database.prepare(`
      UPDATE hub_sync_meta
      SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)
      WHERE key = 'event_count'
    `).run(addedEventCount);
    if (result.changes !== 1) {
      throw new HubSyncStoreError("integrity_failed", "Hub event count metadata가 없습니다.");
    }
  }
}
