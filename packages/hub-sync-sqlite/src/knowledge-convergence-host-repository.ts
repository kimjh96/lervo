import { type DatabaseSync } from "node:sqlite";

import { type HubKnowledgeConvergenceHostCoordinate } from "@lervo/hub-sync";
import {
  isKnowledgeConvergenceHostRecord,
  MAXIMUM_CONVERGENCE_HOST_RECORDS,
  mergeKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostPublishStatus,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

/**
 * One row per repository and host holds an ADR-0469 continuity record. Storage is bounded per
 * repository: past the limit, the stalest observations are pruned. Callers run every method
 * inside the store's transactions.
 */
export class HubKnowledgeConvergenceHostSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  private parse(value: unknown): KnowledgeConvergenceHostRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(value));
    } catch {
      parsed = null;
    }
    if (!isKnowledgeConvergenceHostRecord(parsed))
      throw new HubSyncStoreError(
        "integrity_failed",
        "A stored knowledge convergence host record is invalid.",
      );
    return parsed;
  }

  publish(input: {
    destinationId: string;
    record: KnowledgeConvergenceHostRecord;
    acceptedAt: string;
  }): { status: KnowledgeConvergenceHostPublishStatus; record: KnowledgeConvergenceHostRecord } {
    const { record } = input;
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT record_json FROM hub_knowledge_convergence_hosts
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             AND host_hash = ?`,
        )
        .get(input.destinationId, record.projectId, record.repositoryIdentityHash, record.hostHash),
    );
    const current = row === undefined ? null : this.parse(row.record_json);
    const { next, status } = mergeKnowledgeConvergenceHostRecord({ current, incoming: record });
    if (status === "stale") return { status, record: next };
    this.database
      .prepare(
        `INSERT INTO hub_knowledge_convergence_hosts
           (destination_id, project_id, repository_identity_hash, host_hash, record_json,
            observed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (destination_id, project_id, repository_identity_hash, host_hash)
         DO UPDATE SET record_json = excluded.record_json, observed_at = excluded.observed_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.destinationId,
        next.projectId,
        next.repositoryIdentityHash,
        next.hostHash,
        JSON.stringify(next),
        next.observedAt,
        input.acceptedAt,
      );
    this.database
      .prepare(
        `DELETE FROM hub_knowledge_convergence_hosts
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
           AND host_hash NOT IN (
             SELECT host_hash FROM hub_knowledge_convergence_hosts
             WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             ORDER BY updated_at DESC, host_hash
             LIMIT ?
           )`,
      )
      .run(
        input.destinationId,
        next.projectId,
        next.repositoryIdentityHash,
        input.destinationId,
        next.projectId,
        next.repositoryIdentityHash,
        MAXIMUM_CONVERGENCE_HOST_RECORDS,
      );
    return { status, record: next };
  }

  list(input: HubKnowledgeConvergenceHostCoordinate): KnowledgeConvergenceHostRecord[] {
    return this.database
      .prepare(
        `SELECT record_json FROM hub_knowledge_convergence_hosts
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
         ORDER BY updated_at DESC, host_hash LIMIT ?`,
      )
      .all(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        MAXIMUM_CONVERGENCE_HOST_RECORDS,
      )
      .map((row) => this.parse((row as { record_json: unknown }).record_json));
  }
}
