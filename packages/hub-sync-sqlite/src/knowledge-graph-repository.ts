import type { DatabaseSync } from "node:sqlite";

import {
  assertKnowledgeGraphRelationIntegrity,
  knowledgeGraphNodeKinds,
  knowledgeGraphRelationTypes,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphRelation,
  type KnowledgeGraphRelationType,
} from "@lervo/knowledge-graph";
import type {
  HubKnowledgeGraphCursor,
  HubProjectKnowledgeGraph,
  HubProjectTraceSummary,
  HubTracePage,
  ResolvedHubKnowledgeGraphQuery,
} from "@lervo/hub-trace";
import { eventTypes, type EventType } from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import { integerField, stringField, type SQLiteRow } from "./row-codec.js";
import { sqliteRows } from "./sqlite-row.js";

function enumField<T extends string>(row: SQLiteRow, name: string, values: readonly T[]): T {
  const value = stringField(row, name);
  if (!values.includes(value as T)) {
    throw new HubSyncStoreError("integrity_failed", `The Hub graph ${name} value is invalid.`);
  }
  return value as T;
}

function graphNode(row: SQLiteRow, prefix: "from" | "to"): KnowledgeGraphNode {
  return {
    kind: enumField<KnowledgeGraphNodeKind>(row, `${prefix}_kind`, knowledgeGraphNodeKinds),
    id: stringField(row, `${prefix}_id`),
  };
}

function graphRelation(row: SQLiteRow, projectId: string): KnowledgeGraphRelation {
  const relation: KnowledgeGraphRelation = {
    schemaVersion: 1,
    relationId: stringField(row, "relation_id"),
    projectId,
    type: enumField<KnowledgeGraphRelationType>(row, "relation_type", knowledgeGraphRelationTypes),
    from: graphNode(row, "from"),
    to: graphNode(row, "to"),
    evidence: {
      eventId: stringField(row, "evidence_event_id"),
      eventType: enumField<EventType>(row, "evidence_event_type", eventTypes),
      runId: stringField(row, "evidence_run_id"),
      seq: integerField(row, "evidence_seq"),
    },
  };
  if (
    relation.evidence.eventId !== stringField(row, "source_event_id") ||
    relation.evidence.eventType !== stringField(row, "source_event_type") ||
    relation.evidence.runId !== stringField(row, "source_run_id")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub graph evidence differs from the source event.",
    );
  }
  try {
    assertKnowledgeGraphRelationIntegrity(relation);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub graph relation integrity is invalid.",
      {
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
  return relation;
}

function page(
  items: KnowledgeGraphRelation[],
  limit: number,
): HubTracePage<KnowledgeGraphRelation, HubKnowledgeGraphCursor> {
  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return {
    items,
    nextCursor: hasMore && items.length !== 0 ? { relationId: items.at(-1)!.relationId } : null,
  };
}

export class HubKnowledgeGraphSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(
    query: ResolvedHubKnowledgeGraphQuery,
    project: HubProjectTraceSummary,
  ): HubProjectKnowledgeGraph {
    const rows = sqliteRows(
      this.database
        .prepare(
          `
      SELECT relation.relation_id, relation.relation_type,
        relation.from_kind, relation.from_id, relation.to_kind, relation.to_id,
        relation.evidence_event_id, relation.evidence_event_type,
        relation.evidence_run_id, relation.evidence_seq,
        event.event_id AS source_event_id,
        json_extract(event.event_json, '$.type') AS source_event_type,
        json_extract(event.event_json, '$.runId') AS source_run_id
      FROM hub_knowledge_graph_relations AS relation
      JOIN hub_events AS event
        ON event.destination_id = relation.destination_id
       AND event.project_id = relation.project_id
       AND event.seq = relation.evidence_seq
      WHERE relation.destination_id = ? AND relation.project_id = ?
        AND ((relation.from_kind = ? AND relation.from_id = ?)
          OR (relation.to_kind = ? AND relation.to_id = ?))
        AND relation.relation_id > ?
      ORDER BY relation.relation_id ASC
      LIMIT ?
    `,
        )
        .all(
          query.destinationId,
          query.projectId,
          query.focus.kind,
          query.focus.id,
          query.focus.kind,
          query.focus.id,
          query.after?.relationId ?? "",
          query.limit + 1,
        ),
    );
    return {
      project,
      focus: structuredClone(query.focus),
      relations: page(
        rows.map((row) => graphRelation(row, query.projectId)),
        query.limit,
      ),
    };
  }
}
