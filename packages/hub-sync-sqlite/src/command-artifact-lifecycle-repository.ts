import { randomBytes } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";

import {
  HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT,
  HubCommandError,
  type HubCommandArtifactPurgeClaim,
  type HubCommandArtifactPurgeKind,
} from "@lervo/hub-command";

import { integerField, stringField, type SQLiteRow } from "./row-codec.js";
import { remoteCommandTimestamp } from "./remote-command-row.js";

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const URI_PATTERN = /^lervo-cas:\/\/sha256\/[a-f0-9]{64}$/u;

function claimId(): string {
  return `hcg_${randomBytes(24).toString("base64url")}`;
}

function validateWorker(workerId: string): void {
  if (!WORKER_PATTERN.test(workerId)) {
    throw new HubCommandError("invalid_request", "The artifact cleanup worker ID is invalid.");
  }
}

function validateClaimWindow(input: {
  workerId: string;
  claimedAt: string;
  leaseDurationMs: number;
  limit?: number;
}): { claimedAtMs: number; leaseExpiresAt: string; leaseExpiresAtMs: number } {
  validateWorker(input.workerId);
  const claimedAtMs = remoteCommandTimestamp(input.claimedAt, "artifact claimedAt");
  if (
    !Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 5 * 60_000 ||
    (input.limit !== undefined &&
      (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100))
  ) throw new HubCommandError("invalid_request", "The artifact cleanup claim range is invalid.");
  const leaseExpiresAtMs = claimedAtMs + input.leaseDurationMs;
  return {
    claimedAtMs,
    leaseExpiresAtMs,
    leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
  };
}

function parseKind(value: string): HubCommandArtifactPurgeKind {
  if (value !== "expired" && value !== "orphan") {
    throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup kind is invalid.");
  }
  return value;
}

function boundedDeliveryIds(database: DatabaseSync, artifactUri: string): string[] {
  return database.prepare(`
    SELECT authorship.delivery_id
    FROM hub_remote_command_authorships AS authorship
    LEFT JOIN hub_remote_command_artifact_purges AS purge
      ON purge.delivery_id = authorship.delivery_id
    WHERE authorship.artifact_uri = ? AND purge.delivery_id IS NULL
    ORDER BY authorship.delivery_id
    LIMIT ?
  `).all(
    artifactUri,
    HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT + 1,
  ).map((row) => stringField(row, "delivery_id"));
}

function hasUnpurgedReference(database: DatabaseSync, artifactUri: string): boolean {
  return database.prepare(`
    SELECT 1
    FROM hub_remote_command_authorships AS authorship
    LEFT JOIN hub_remote_command_artifact_purges AS purge
      ON purge.delivery_id = authorship.delivery_id
    WHERE authorship.artifact_uri = ? AND purge.delivery_id IS NULL
    LIMIT 1
  `).get(artifactUri) !== undefined;
}

function parseClaim(row: SQLiteRow): HubCommandArtifactPurgeClaim {
  const artifactUri = stringField(row, "artifact_uri");
  return {
    claimId: stringField(row, "claim_id"),
    kind: parseKind(stringField(row, "kind")),
    artifactUri,
    workerId: stringField(row, "worker_id"),
    claimedAt: stringField(row, "claimed_at"),
    leaseExpiresAt: stringField(row, "lease_expires_at"),
  };
}

export class HubCommandArtifactLifecycleSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  claimExpired(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): HubCommandArtifactPurgeClaim[] {
    const window = validateClaimWindow(input);
    this.database.prepare(
      "DELETE FROM hub_remote_command_artifact_gc_claims WHERE lease_expires_at_ms <= ?",
    ).run(window.claimedAtMs);
    const candidates = this.database.prepare(`
      SELECT authorship.artifact_uri
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      JOIN hub_remote_command_artifact_retentions AS retention
        ON retention.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_purges AS purge
        ON purge.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_gc_claims AS claim
        ON claim.artifact_uri = authorship.artifact_uri
      WHERE purge.delivery_id IS NULL AND claim.artifact_uri IS NULL
      GROUP BY authorship.artifact_uri
      HAVING MAX(retention.retain_until_ms) <= ? AND MAX(command.expires_at_ms) <= ?
      ORDER BY MAX(retention.retain_until_ms), authorship.artifact_uri
      LIMIT ?
    `).all(window.claimedAtMs, window.claimedAtMs, input.limit);
    const claims: HubCommandArtifactPurgeClaim[] = [];
    for (const candidate of candidates) {
      const artifactUri = stringField(candidate, "artifact_uri");
      const id = claimId();
      this.database.prepare(`
        INSERT INTO hub_remote_command_artifact_gc_claims (
          artifact_uri, claim_id, kind, worker_id, observed_modified_at,
          observed_modified_at_ms, claimed_at, claimed_at_ms,
          lease_expires_at, lease_expires_at_ms
        ) VALUES (?, ?, 'expired', ?, NULL, NULL, ?, ?, ?, ?)
      `).run(
        artifactUri, id, input.workerId, input.claimedAt, window.claimedAtMs,
        window.leaseExpiresAt, window.leaseExpiresAtMs,
      );
      claims.push({
        claimId: id,
        kind: "expired",
        artifactUri,
        workerId: input.workerId,
        claimedAt: input.claimedAt,
        leaseExpiresAt: window.leaseExpiresAt,
      });
    }
    return claims;
  }

  claimOrphan(input: {
    workerId: string;
    artifactUri: string;
    observedModifiedAt: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): HubCommandArtifactPurgeClaim | null {
    const window = validateClaimWindow(input);
    const observedModifiedAtMs = remoteCommandTimestamp(
      input.observedModifiedAt,
      "artifact observedModifiedAt",
    );
    if (!URI_PATTERN.test(input.artifactUri) || observedModifiedAtMs > window.claimedAtMs) {
      throw new HubCommandError("invalid_request", "The orphan artifact observation is invalid.");
    }
    this.database.prepare(`
      DELETE FROM hub_remote_command_artifact_gc_claims
      WHERE artifact_uri = ? AND lease_expires_at_ms <= ?
    `).run(input.artifactUri, window.claimedAtMs);
    const active = this.database.prepare(`
      SELECT claim_id FROM hub_remote_command_artifact_gc_claims WHERE artifact_uri = ?
    `).get(input.artifactUri);
    if (active !== undefined || hasUnpurgedReference(this.database, input.artifactUri)) return null;
    const id = claimId();
    this.database.prepare(`
      INSERT INTO hub_remote_command_artifact_gc_claims (
        artifact_uri, claim_id, kind, worker_id, observed_modified_at,
        observed_modified_at_ms, claimed_at, claimed_at_ms,
        lease_expires_at, lease_expires_at_ms
      ) VALUES (?, ?, 'orphan', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.artifactUri, id, input.workerId, input.observedModifiedAt, observedModifiedAtMs,
      input.claimedAt, window.claimedAtMs, window.leaseExpiresAt, window.leaseExpiresAtMs,
    );
    return {
      claimId: id,
      kind: "orphan",
      artifactUri: input.artifactUri,
      workerId: input.workerId,
      claimedAt: input.claimedAt,
      leaseExpiresAt: window.leaseExpiresAt,
    };
  }

  complete(input: { claimId: string; workerId: string; completedAt: string }): {
    status: "completed" | "partial" | "duplicate";
    kind: HubCommandArtifactPurgeKind;
    purgedDeliveryCount: number;
    continuationRecommended: boolean;
  } {
    validateWorker(input.workerId);
    const completedAtMs = remoteCommandTimestamp(input.completedAt, "artifact completedAt");
    const prior = this.database.prepare(`
      SELECT kind, completion_status, purged_delivery_count
      FROM hub_remote_command_artifact_gc_completions WHERE claim_id = ? AND worker_id = ?
    `).get(input.claimId, input.workerId);
    if (prior !== undefined) return {
      status: "duplicate",
      kind: parseKind(stringField(prior, "kind")),
      purgedDeliveryCount: integerField(prior, "purged_delivery_count"),
      continuationRecommended: stringField(prior, "completion_status") === "partial",
    };
    const row = this.database.prepare(`
      SELECT * FROM hub_remote_command_artifact_gc_claims
      WHERE claim_id = ? AND worker_id = ?
        AND claimed_at_ms <= ? AND lease_expires_at_ms >= ?
    `).get(input.claimId, input.workerId, completedAtMs, completedAtMs);
    if (row === undefined) {
      throw new HubCommandError("artifact_cleanup_conflict", "The artifact cleanup claim is missing or expired.");
    }
    const claim = parseClaim(row);
    const ids = boundedDeliveryIds(this.database, claim.artifactUri);
    let completionStatus: "completed" | "partial" = "completed";
    let purgedIds = ids;
    if (claim.kind === "expired") {
      const blocked = this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM hub_remote_command_authorships AS authorship
        JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
        JOIN hub_remote_command_artifact_retentions AS retention
          ON retention.delivery_id = authorship.delivery_id
        LEFT JOIN hub_remote_command_artifact_purges AS purge
          ON purge.delivery_id = authorship.delivery_id
        WHERE authorship.artifact_uri = ? AND purge.delivery_id IS NULL
          AND (retention.retain_until_ms > ? OR command.expires_at_ms > ?)
      `).get(claim.artifactUri, completedAtMs, completedAtMs);
      if (integerField(blocked!, "count") !== 0 || ids.length === 0) {
        throw new HubCommandError("artifact_cleanup_conflict", "The artifact retention condition changed during cleanup.");
      }
      if (ids.length > HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT) {
        completionStatus = "partial";
        purgedIds = ids.slice(0, HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT);
      }
      const pendingSince = this.database.prepare(`
        SELECT MAX(partial.completed_at_ms) AS pending_since
        FROM hub_remote_command_artifact_gc_completions AS partial
        WHERE partial.artifact_uri = ? AND partial.completion_status = 'partial'
          AND NOT EXISTS (
            SELECT 1 FROM hub_remote_command_artifact_gc_completions AS completed
            WHERE completed.artifact_uri = partial.artifact_uri
              AND completed.completion_status = 'completed'
              AND completed.completed_at_ms >= partial.completed_at_ms
          )
      `).get(claim.artifactUri)?.pending_since;
      if (
        completionStatus === "completed" && typeof pendingSince === "number" &&
        completedAtMs < pendingSince
      ) throw new HubCommandError("artifact_cleanup_conflict", "The artifact partial-cleanup time moved backwards.");
      const insert = this.database.prepare(`
        INSERT INTO hub_remote_command_artifact_purges (
          delivery_id, artifact_uri, claim_id, purged_at, purged_at_ms
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const id of purgedIds) {
        insert.run(id, claim.artifactUri, claim.claimId, input.completedAt, completedAtMs);
      }
    } else if (hasUnpurgedReference(this.database, claim.artifactUri)) {
      throw new HubCommandError("artifact_cleanup_conflict", "A new authorship reference appeared for the orphan artifact.");
    }
    this.database.prepare(`
      INSERT INTO hub_remote_command_artifact_gc_completions (
        claim_id, kind, completion_status, artifact_uri, worker_id, purged_delivery_count,
        completed_at, completed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      claim.claimId, claim.kind, completionStatus, claim.artifactUri, claim.workerId,
      purgedIds.length,
      input.completedAt, completedAtMs,
    );
    this.database.prepare(
      "DELETE FROM hub_remote_command_artifact_gc_claims WHERE claim_id = ?",
    ).run(claim.claimId);
    return {
      status: completionStatus,
      kind: claim.kind,
      purgedDeliveryCount: purgedIds.length,
      continuationRecommended: completionStatus === "partial",
    };
  }

  release(input: { claimId: string; workerId: string; releasedAt: string }): void {
    validateWorker(input.workerId);
    remoteCommandTimestamp(input.releasedAt, "artifact releasedAt");
    this.database.prepare(`
      DELETE FROM hub_remote_command_artifact_gc_claims
      WHERE claim_id = ? AND worker_id = ?
    `).run(input.claimId, input.workerId);
  }
}
