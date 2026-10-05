import { type DatabaseSync } from "node:sqlite";

import { type HubKnowledgeConvergenceOwnerCoordinate } from "@lervo/hub-sync";
import {
  decideKnowledgeConvergenceOwnerMutation,
  isKnowledgeConvergenceOwnerLease,
  readKnowledgeConvergenceOwnerLease,
  type KnowledgeConvergenceOwnerDecision,
  type KnowledgeConvergenceOwnerLease,
  type KnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerReading,
} from "@lervo/sync-contract";

import { HubSyncStoreError } from "./errors.js";
import { sqliteRow } from "./sqlite-row.js";

/**
 * One row per repository identity holds the current or last ended convergence owner lease, so
 * storage stays bounded by the number of coordinated repositories. Callers run every method inside
 * the store's write or read transaction.
 */
export class HubKnowledgeConvergenceOwnerSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  private current(
    coordinate: HubKnowledgeConvergenceOwnerCoordinate,
  ): { lease: KnowledgeConvergenceOwnerLease; revision: number } | null {
    const row = sqliteRow(
      this.database
        .prepare(
          `SELECT lease_json, revision FROM hub_knowledge_convergence_owner_leases
           WHERE destination_id = ? AND project_id = ? AND repository_identity_hash = ?`,
        )
        .get(coordinate.destinationId, coordinate.projectId, coordinate.repositoryIdentityHash),
    );
    if (row === undefined) return null;
    let lease: unknown;
    try {
      lease = JSON.parse(String(row.lease_json));
    } catch {
      lease = null;
    }
    if (
      !isKnowledgeConvergenceOwnerLease(lease) ||
      lease.projectId !== coordinate.projectId ||
      lease.repositoryIdentityHash !== coordinate.repositoryIdentityHash
    )
      throw new HubSyncStoreError(
        "integrity_failed",
        "A stored knowledge convergence owner lease is invalid.",
      );
    return { lease, revision: Number(row.revision) };
  }

  mutate(input: {
    destinationId: string;
    mutation: KnowledgeConvergenceOwnerMutation;
    acceptedAt: string;
  }): KnowledgeConvergenceOwnerDecision {
    const coordinate = {
      destinationId: input.destinationId,
      projectId: input.mutation.request.projectId,
      repositoryIdentityHash: input.mutation.request.repositoryIdentityHash,
    };
    const stored = this.current(coordinate);
    const { next, decision } = decideKnowledgeConvergenceOwnerMutation({
      current: stored?.lease ?? null,
      mutation: input.mutation,
      acceptedAt: input.acceptedAt,
    });
    if (next !== null && next !== stored?.lease)
      this.database
        .prepare(
          `INSERT INTO hub_knowledge_convergence_owner_leases
             (destination_id, project_id, repository_identity_hash, lease_json, revision, updated_at)
           VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT (destination_id, project_id, repository_identity_hash) DO UPDATE SET
             lease_json = excluded.lease_json,
             revision = hub_knowledge_convergence_owner_leases.revision + 1,
             updated_at = excluded.updated_at`,
        )
        .run(
          coordinate.destinationId,
          coordinate.projectId,
          coordinate.repositoryIdentityHash,
          JSON.stringify(next),
          input.acceptedAt,
        );
    return decision;
  }

  read(
    input: HubKnowledgeConvergenceOwnerCoordinate & { acceptedAt: string },
  ): KnowledgeConvergenceOwnerReading {
    return readKnowledgeConvergenceOwnerLease({
      current: this.current(input)?.lease ?? null,
      acceptedAt: input.acceptedAt,
    });
  }
}
