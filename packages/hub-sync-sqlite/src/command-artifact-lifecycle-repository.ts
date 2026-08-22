import { randomBytes } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";

import {
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
    throw new HubCommandError("invalid_request", "artifact cleanup worker ID가 유효하지 않습니다.");
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
  ) throw new HubCommandError("invalid_request", "artifact cleanup claim 범위가 유효하지 않습니다.");
  const leaseExpiresAtMs = claimedAtMs + input.leaseDurationMs;
  return {
    claimedAtMs,
    leaseExpiresAtMs,
    leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
  };
}

function parseKind(value: string): HubCommandArtifactPurgeKind {
  if (value !== "expired" && value !== "orphan") {
    throw new HubCommandError("artifact_integrity_failed", "artifact cleanup 종류가 유효하지 않습니다.");
  }
  return value;
}

function deliveryIds(database: DatabaseSync, artifactUri: string): string[] {
  return database.prepare(`
    SELECT authorship.delivery_id
    FROM hub_remote_command_authorships AS authorship
    LEFT JOIN hub_remote_command_artifact_purges AS purge
      ON purge.delivery_id = authorship.delivery_id
    WHERE authorship.artifact_uri = ? AND purge.delivery_id IS NULL
    ORDER BY authorship.delivery_id
  `).all(artifactUri).map((row) => stringField(row, "delivery_id"));
}

function parseClaim(database: DatabaseSync, row: SQLiteRow): HubCommandArtifactPurgeClaim {
  const artifactUri = stringField(row, "artifact_uri");
  return {
    claimId: stringField(row, "claim_id"),
    kind: parseKind(stringField(row, "kind")),
    artifactUri,
    workerId: stringField(row, "worker_id"),
    claimedAt: stringField(row, "claimed_at"),
    leaseExpiresAt: stringField(row, "lease_expires_at"),
    deliveryIds: deliveryIds(database, artifactUri),
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
        deliveryIds: deliveryIds(this.database, artifactUri),
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
      throw new HubCommandError("invalid_request", "orphan artifact 관측값이 유효하지 않습니다.");
    }
    this.database.prepare(`
      DELETE FROM hub_remote_command_artifact_gc_claims
      WHERE artifact_uri = ? AND lease_expires_at_ms <= ?
    `).run(input.artifactUri, window.claimedAtMs);
    const active = this.database.prepare(`
      SELECT claim_id FROM hub_remote_command_artifact_gc_claims WHERE artifact_uri = ?
    `).get(input.artifactUri);
    if (active !== undefined || deliveryIds(this.database, input.artifactUri).length !== 0) return null;
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
      deliveryIds: [],
    };
  }

  complete(input: { claimId: string; workerId: string; completedAt: string }): {
    status: "completed" | "duplicate";
    kind: HubCommandArtifactPurgeKind;
    purgedDeliveryCount: number;
  } {
    validateWorker(input.workerId);
    const completedAtMs = remoteCommandTimestamp(input.completedAt, "artifact completedAt");
    const prior = this.database.prepare(`
      SELECT kind, purged_delivery_count
      FROM hub_remote_command_artifact_gc_completions WHERE claim_id = ? AND worker_id = ?
    `).get(input.claimId, input.workerId);
    if (prior !== undefined) return {
      status: "duplicate",
      kind: parseKind(stringField(prior, "kind")),
      purgedDeliveryCount: integerField(prior, "purged_delivery_count"),
    };
    const row = this.database.prepare(`
      SELECT * FROM hub_remote_command_artifact_gc_claims
      WHERE claim_id = ? AND worker_id = ? AND lease_expires_at_ms >= ?
    `).get(input.claimId, input.workerId, completedAtMs);
    if (row === undefined) {
      throw new HubCommandError("artifact_cleanup_conflict", "artifact cleanup claim이 없거나 만료됐습니다.");
    }
    const claim = parseClaim(this.database, row);
    const ids = deliveryIds(this.database, claim.artifactUri);
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
        throw new HubCommandError("artifact_cleanup_conflict", "artifact 보존 조건이 정리 중에 바뀌었습니다.");
      }
      const insert = this.database.prepare(`
        INSERT INTO hub_remote_command_artifact_purges (
          delivery_id, artifact_uri, claim_id, purged_at, purged_at_ms
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const id of ids) insert.run(id, claim.artifactUri, claim.claimId, input.completedAt, completedAtMs);
    } else if (ids.length !== 0) {
      throw new HubCommandError("artifact_cleanup_conflict", "orphan artifact에 새 작성 참조가 생겼습니다.");
    }
    this.database.prepare(`
      INSERT INTO hub_remote_command_artifact_gc_completions (
        claim_id, kind, artifact_uri, worker_id, purged_delivery_count,
        completed_at, completed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      claim.claimId, claim.kind, claim.artifactUri, claim.workerId, ids.length,
      input.completedAt, completedAtMs,
    );
    this.database.prepare(
      "DELETE FROM hub_remote_command_artifact_gc_claims WHERE claim_id = ?",
    ).run(claim.claimId);
    return { status: "completed", kind: claim.kind, purgedDeliveryCount: ids.length };
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
