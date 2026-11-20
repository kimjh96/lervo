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
 * ADR-0602: how long a lease outlives its holder's departure from the Hub, so a holder that
 * restarts or reconnects keeps it; peers are woken at the departure and wake once more at expiry.
 */
export const KNOWLEDGE_CONVERGENCE_OWNER_ABSENCE_GRACE_MS = 60_000;

/**
 * When a host has been waiting on the Hub continuously since (milliseconds), or null when it is
 * not waiting now.
 */
export type HolderPresence = (hostHash: string) => number | null;

/**
 * A lease whose holder has waited on the Hub continuously since before its recorded expiry,
 * renewed to `at` for its own lease length: a present holder's lease never lapses by time.
 */
function presentLease(
  lease: KnowledgeConvergenceOwnerLease,
  at: string,
  present: HolderPresence,
): KnowledgeConvergenceOwnerLease {
  const since = present(lease.holderHostHash);
  if (lease.releasedAt !== null || since === null || since > Date.parse(lease.expiresAt))
    return lease;
  const length = Date.parse(lease.expiresAt) - Date.parse(lease.renewedAt);
  const expiresAt = Date.parse(at) + length;
  return expiresAt > Date.parse(lease.expiresAt)
    ? { ...lease, renewedAt: at, expiresAt: new Date(expiresAt).toISOString() }
    : lease;
}

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

  mutate(
    input: {
      destinationId: string;
      mutation: KnowledgeConvergenceOwnerMutation;
      acceptedAt: string;
    },
    present: HolderPresence = () => null,
  ): KnowledgeConvergenceOwnerDecision {
    const coordinate = {
      destinationId: input.destinationId,
      projectId: input.mutation.request.projectId,
      repositoryIdentityHash: input.mutation.request.repositoryIdentityHash,
    };
    const stored = this.current(coordinate);
    // ADR-0602: a present holder's lease is live whatever its recorded expiry.
    const current = stored === null ? null : presentLease(stored.lease, input.acceptedAt, present);
    const { next, decision } = decideKnowledgeConvergenceOwnerMutation({
      current,
      mutation: input.mutation,
      acceptedAt: input.acceptedAt,
    });
    if (next !== null && next !== stored?.lease) this.write(coordinate, next, input.acceptedAt);
    return decision.lease === null
      ? decision
      : { ...decision, holderPresent: present(decision.lease.holderHostHash) !== null };
  }

  private write(
    coordinate: HubKnowledgeConvergenceOwnerCoordinate,
    next: KnowledgeConvergenceOwnerLease,
    at: string,
  ): void {
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
        at,
      );
  }

  read(
    input: HubKnowledgeConvergenceOwnerCoordinate & { acceptedAt: string },
    present: HolderPresence = () => null,
  ): KnowledgeConvergenceOwnerReading {
    const lease = this.current(input)?.lease ?? null;
    const reading = readKnowledgeConvergenceOwnerLease({
      current: lease === null ? null : presentLease(lease, input.acceptedAt, present),
      acceptedAt: input.acceptedAt,
    });
    return lease === null
      ? reading
      : { ...reading, holderPresent: present(lease.holderHostHash) !== null };
  }

  /**
   * ADR-0602: a live lease follows its holder's presence. While the holder waits on the Hub, the
   * lease is kept live, so it needs no renewal; once it leaves, the lease expires within the
   * absence grace unless the holder returns first.
   */
  presence(
    coordinate: HubKnowledgeConvergenceOwnerCoordinate,
    hostHash: string,
    connected: boolean,
    at: string,
  ): void {
    const stored = this.current(coordinate);
    const lease = stored?.lease;
    if (
      lease === undefined ||
      lease.holderHostHash !== hostHash ||
      lease.releasedAt !== null ||
      Date.parse(lease.expiresAt) <= Date.parse(at)
    )
      return;
    const expiresAt = connected
      ? presentLease(lease, at, () => Date.parse(at)).expiresAt
      : new Date(
          Math.min(
            Date.parse(lease.expiresAt),
            Date.parse(at) + KNOWLEDGE_CONVERGENCE_OWNER_ABSENCE_GRACE_MS,
          ),
        ).toISOString();
    if (expiresAt === lease.expiresAt) return;
    this.write(coordinate, { ...lease, expiresAt }, at);
  }
}
