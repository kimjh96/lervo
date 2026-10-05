import { type DatabaseSync } from "node:sqlite";

import { type HubKnowledgeInstructionCandidateCoordinate } from "@lervo/hub-sync";
import {
  isKnowledgeInstructionCandidateRecord,
  MAXIMUM_INSTRUCTION_CANDIDATE_RECORDS,
  mergeKnowledgeInstructionCandidateRecord,
  type KnowledgeInstructionCandidatePublishStatus,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

/**
 * One row per repository and proposed-Markdown hash holds an ADR-0467 owner-rule candidate.
 * Storage is bounded per repository: past the limit, resolved records are pruned oldest first,
 * then the oldest open records. Callers run every method inside the store's transactions.
 */
export class HubKnowledgeInstructionCandidateSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  private parse(value: unknown): KnowledgeInstructionCandidateRecord {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(value));
    } catch {
      parsed = null;
    }
    if (!isKnowledgeInstructionCandidateRecord(parsed))
      throw new HubSyncStoreError(
        "integrity_failed",
        "A stored knowledge instruction candidate is invalid.",
      );
    return parsed;
  }

  publish(input: {
    destinationId: string;
    record: KnowledgeInstructionCandidateRecord;
    acceptedAt: string;
  }): {
    status: KnowledgeInstructionCandidatePublishStatus;
    record: KnowledgeInstructionCandidateRecord;
  } {
    const { record } = input;
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT record_json FROM hub_knowledge_instruction_candidates
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             AND proposed_content_hash = ?`,
        )
        .get(
          input.destinationId,
          record.projectId,
          record.repositoryIdentityHash,
          record.proposedContentHash,
        ),
    );
    const current = row === undefined ? null : this.parse(row.record_json);
    const { next, status } = mergeKnowledgeInstructionCandidateRecord({
      current,
      incoming: record,
    });
    if (status === "duplicate") return { status, record: next };
    this.database
      .prepare(
        `INSERT INTO hub_knowledge_instruction_candidates
           (destination_id, project_id, repository_identity_hash, proposed_content_hash,
            record_json, resolution, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (destination_id, project_id, repository_identity_hash, proposed_content_hash)
         DO UPDATE SET record_json = excluded.record_json, resolution = excluded.resolution,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.destinationId,
        next.projectId,
        next.repositoryIdentityHash,
        next.proposedContentHash,
        JSON.stringify(next),
        next.resolution,
        input.acceptedAt,
      );
    this.database
      .prepare(
        `DELETE FROM hub_knowledge_instruction_candidates
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
           AND proposed_content_hash NOT IN (
             SELECT proposed_content_hash FROM hub_knowledge_instruction_candidates
             WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             ORDER BY (resolution = 'open') DESC, updated_at DESC, proposed_content_hash
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
        MAXIMUM_INSTRUCTION_CANDIDATE_RECORDS,
      );
    return { status, record: next };
  }

  list(input: HubKnowledgeInstructionCandidateCoordinate): KnowledgeInstructionCandidateRecord[] {
    return this.database
      .prepare(
        `SELECT record_json FROM hub_knowledge_instruction_candidates
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
         ORDER BY updated_at DESC, proposed_content_hash LIMIT ?`,
      )
      .all(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        MAXIMUM_INSTRUCTION_CANDIDATE_RECORDS,
      )
      .map((row) => this.parse((row as { record_json: unknown }).record_json));
  }
}
