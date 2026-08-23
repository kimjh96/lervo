import type { DatabaseSync } from "node:sqlite";

import {
  assertKnowledgeGraphRelationIntegrity,
  projectKnowledgeGraphEvent,
  type KnowledgeGraphRelation,
} from "@lervo/knowledge-graph";
import type { HubProjectCoordinate } from "@lervo/hub-sync";
import type { EventEnvelope } from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import { decodeStoredEvent, integerField, stringField, type SQLiteRow } from "./row-codec.js";

const KNOWLEDGE_GRAPH_INDEX_VERSION = 1;

export class KnowledgeGraphIndexSQLiteWriter {
  constructor(private readonly database: DatabaseSync) {}

  rebuildIfRequired(): void {
    const row = this.database.prepare(
      "SELECT value FROM hub_sync_meta WHERE key = ?",
    ).get("knowledge_graph_index_version");
    if (row === undefined) {
      throw new HubSyncStoreError("integrity_failed", "The knowledge graph index version is missing.");
    }
    const version = Number(stringField(row, "value"));
    if (version === KNOWLEDGE_GRAPH_INDEX_VERSION) return;
    if (!Number.isSafeInteger(version) || version < 0 || version > KNOWLEDGE_GRAPH_INDEX_VERSION) {
      throw new HubSyncStoreError("integrity_failed", "The knowledge graph index version is invalid.");
    }

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.exec("DELETE FROM hub_knowledge_graph_relations;");
      const rows = this.database.prepare(`
        SELECT destination_id, project_id, seq, event_id, event_hash, previous_hash, event_json
        FROM hub_events
        ORDER BY destination_id ASC, project_id ASC, seq ASC
      `).iterate() as Iterable<SQLiteRow>;
      for (const stored of rows) {
        this.addEvents({
          destinationId: stringField(stored, "destination_id"),
          projectId: stringField(stored, "project_id"),
        }, [decodeStoredEvent(stored)]);
      }
      this.database.prepare(
        "UPDATE hub_sync_meta SET value = ? WHERE key = ?",
      ).run(String(KNOWLEDGE_GRAPH_INDEX_VERSION), "knowledge_graph_index_version");
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  addEvents(coordinate: HubProjectCoordinate, events: readonly EventEnvelope[]): void {
    for (const event of events) {
      if (event.projectId !== coordinate.projectId) {
        throw new HubSyncStoreError("integrity_failed", "The graph event has different project coordinates.");
      }
      for (const relation of projectKnowledgeGraphEvent(event)) {
        assertKnowledgeGraphRelationIntegrity(relation);
        this.upsert(coordinate, relation);
      }
    }
  }

  assertMatchesEvents(coordinate: HubProjectCoordinate, events: readonly EventEnvelope[]): void {
    const expected = new Map<string, KnowledgeGraphRelation>();
    for (const event of events) {
      for (const relation of projectKnowledgeGraphEvent(event)) {
        const current = expected.get(relation.relationId);
        if (current === undefined || relation.evidence.seq < current.evidence.seq) {
          expected.set(relation.relationId, relation);
        }
      }
    }
    const rows = this.database.prepare(`
      SELECT relation_id, relation_type, from_kind, from_id, to_kind, to_id,
        evidence_event_id, evidence_event_type, evidence_run_id, evidence_seq
      FROM hub_knowledge_graph_relations
      WHERE destination_id = ? AND project_id = ?
    `).all(coordinate.destinationId, coordinate.projectId);
    if (rows.length !== expected.size) {
      throw new HubSyncStoreError("integrity_failed", "The knowledge graph index relation count differs from the event projection.");
    }
    for (const row of rows) {
      const relation = expected.get(stringField(row, "relation_id"));
      if (relation === undefined ||
        stringField(row, "relation_type") !== relation.type ||
        stringField(row, "from_kind") !== relation.from.kind ||
        stringField(row, "from_id") !== relation.from.id ||
        stringField(row, "to_kind") !== relation.to.kind ||
        stringField(row, "to_id") !== relation.to.id ||
        stringField(row, "evidence_event_id") !== relation.evidence.eventId ||
        stringField(row, "evidence_event_type") !== relation.evidence.eventType ||
        stringField(row, "evidence_run_id") !== relation.evidence.runId ||
        integerField(row, "evidence_seq") !== relation.evidence.seq) {
        throw new HubSyncStoreError("integrity_failed", "The knowledge graph index differs from the source event projection.");
      }
    }
  }

  private upsert(coordinate: HubProjectCoordinate, relation: KnowledgeGraphRelation): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO hub_knowledge_graph_relations (
        destination_id, project_id, relation_id, relation_type,
        from_kind, from_id, to_kind, to_id,
        evidence_event_id, evidence_event_type, evidence_run_id, evidence_seq
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      coordinate.destinationId,
      coordinate.projectId,
      relation.relationId,
      relation.type,
      relation.from.kind,
      relation.from.id,
      relation.to.kind,
      relation.to.id,
      relation.evidence.eventId,
      relation.evidence.eventType,
      relation.evidence.runId,
      relation.evidence.seq,
    );
    const stored = this.database.prepare(`
      SELECT relation_type, from_kind, from_id, to_kind, to_id, evidence_seq
      FROM hub_knowledge_graph_relations
      WHERE destination_id = ? AND project_id = ? AND relation_id = ?
    `).get(coordinate.destinationId, coordinate.projectId, relation.relationId);
    if (stored === undefined ||
      stringField(stored, "relation_type") !== relation.type ||
      stringField(stored, "from_kind") !== relation.from.kind ||
      stringField(stored, "from_id") !== relation.from.id ||
      stringField(stored, "to_kind") !== relation.to.kind ||
      stringField(stored, "to_id") !== relation.to.id) {
      throw new HubSyncStoreError("integrity_failed", "A knowledge graph relation ID conflict occurred.");
    }
    if (integerField(stored, "evidence_seq") > relation.evidence.seq) {
      this.database.prepare(`
        UPDATE hub_knowledge_graph_relations
        SET evidence_event_id = ?, evidence_event_type = ?, evidence_run_id = ?, evidence_seq = ?
        WHERE destination_id = ? AND project_id = ? AND relation_id = ?
      `).run(
        relation.evidence.eventId,
        relation.evidence.eventType,
        relation.evidence.runId,
        relation.evidence.seq,
        coordinate.destinationId,
        coordinate.projectId,
        relation.relationId,
      );
    }
  }
}
