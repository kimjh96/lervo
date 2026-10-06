import { type DatabaseSync } from "node:sqlite";

import { type HubKnowledgeConvergenceHostCoordinate } from "@lervo/hub-sync";
import {
  isKnowledgeConvergenceDefinition,
  knowledgeConvergenceDefinitionSummary,
  MAXIMUM_CONVERGENCE_DEFINITIONS,
  type KnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinitionPublishStatus,
  type KnowledgeConvergenceDefinitionSummary,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

/**
 * One row per repository and content hash holds an ADR-0477 delegation-bound definition. The
 * first stored bytes of a content hash are kept; a repeated publish refreshes only its time.
 * Storage is bounded per repository: past the limit, the least recently published rows are
 * pruned. Callers run every method inside the store's transactions.
 */
export class HubKnowledgeConvergenceDefinitionSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  private parse(value: unknown): KnowledgeConvergenceDefinition {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(value));
    } catch {
      parsed = null;
    }
    if (!isKnowledgeConvergenceDefinition(parsed))
      throw new HubSyncStoreError(
        "integrity_failed",
        "A stored knowledge convergence definition is invalid.",
      );
    return parsed;
  }

  publish(input: {
    destinationId: string;
    definition: KnowledgeConvergenceDefinition;
    acceptedAt: string;
  }): { status: KnowledgeConvergenceDefinitionPublishStatus } {
    const { definition } = input;
    const existing = sqliteRow(
      this.database
        .prepare(
          `SELECT content_hash FROM hub_knowledge_convergence_definitions
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             AND content_hash = ?`,
        )
        .get(
          input.destinationId,
          definition.projectId,
          definition.repositoryIdentityHash,
          definition.contentHash,
        ),
    );
    if (existing === undefined)
      this.database
        .prepare(
          `INSERT INTO hub_knowledge_convergence_definitions
             (destination_id, project_id, repository_identity_hash, content_hash, kind,
              binding_hash, definition_json, published_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.destinationId,
          definition.projectId,
          definition.repositoryIdentityHash,
          definition.contentHash,
          definition.kind,
          definition.bindingHash,
          JSON.stringify(definition),
          definition.publishedAt,
          input.acceptedAt,
        );
    else
      this.database
        .prepare(
          `UPDATE hub_knowledge_convergence_definitions SET updated_at = ?
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             AND content_hash = ?`,
        )
        .run(
          input.acceptedAt,
          input.destinationId,
          definition.projectId,
          definition.repositoryIdentityHash,
          definition.contentHash,
        );
    this.database
      .prepare(
        `DELETE FROM hub_knowledge_convergence_definitions
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
           AND content_hash NOT IN (
             SELECT content_hash FROM hub_knowledge_convergence_definitions
             WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             ORDER BY updated_at DESC, content_hash
             LIMIT ?
           )`,
      )
      .run(
        input.destinationId,
        definition.projectId,
        definition.repositoryIdentityHash,
        input.destinationId,
        definition.projectId,
        definition.repositoryIdentityHash,
        MAXIMUM_CONVERGENCE_DEFINITIONS,
      );
    return { status: existing === undefined ? "created" : "refreshed" };
  }

  /** Summaries carry the refresh time, so a publisher knows which definitions need it. */
  list(input: HubKnowledgeConvergenceHostCoordinate): KnowledgeConvergenceDefinitionSummary[] {
    return this.database
      .prepare(
        `SELECT definition_json, updated_at FROM hub_knowledge_convergence_definitions
         WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
         ORDER BY updated_at DESC, content_hash LIMIT ?`,
      )
      .all(
        input.destinationId,
        input.projectId,
        input.repositoryIdentityHash,
        MAXIMUM_CONVERGENCE_DEFINITIONS,
      )
      .map((row) => {
        const { definition_json: json, updated_at: updatedAt } = row as {
          definition_json: unknown;
          updated_at: unknown;
        };
        return {
          ...knowledgeConvergenceDefinitionSummary(this.parse(json)),
          publishedAt: String(updatedAt),
        };
      });
  }

  read(
    input: HubKnowledgeConvergenceHostCoordinate & { contentHash: string },
  ): KnowledgeConvergenceDefinition | null {
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT definition_json FROM hub_knowledge_convergence_definitions
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?
             AND content_hash = ?`,
        )
        .get(input.destinationId, input.projectId, input.repositoryIdentityHash, input.contentHash),
    );
    return row === undefined ? null : this.parse(row.definition_json);
  }
}
