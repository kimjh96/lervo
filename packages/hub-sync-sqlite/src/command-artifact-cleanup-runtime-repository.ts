import { randomBytes } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";

import {
  HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT,
  HubCommandError,
  type HubCommandArtifactCleanupCycleClaimInput,
  type HubCommandArtifactCleanupCycleCompletion,
  type HubCommandArtifactCleanupCycleFailure,
  type HubCommandArtifactCleanupScheduleClaim,
} from "@lervo/hub-command";

import { integerField, nullableStringField, stringField } from "./row-codec.js";
import { remoteCommandTimestamp } from "./remote-command-row.js";

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const CURSOR_PATTERN = /^lervo-cas:\/\/sha256\/[a-f0-9]{64}$/u;

function validateWorker(workerId: string): void {
  if (!WORKER_PATTERN.test(workerId)) {
    throw new HubCommandError(
      "invalid_request",
      "The artifact cleanup runtime worker ID is invalid.",
    );
  }
}

function validateLeaseDuration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30 * 60_000) {
    throw new HubCommandError("invalid_request", "The artifact cleanup runtime lease is invalid.");
  }
}

function validateCursor(value: string | null): void {
  if (value !== null && !CURSOR_PATTERN.test(value)) {
    throw new HubCommandError(
      "invalid_request",
      "The artifact cleanup inventory cursor is invalid.",
    );
  }
}

function validateCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HubCommandError("invalid_request", "The artifact cleanup result count is invalid.");
  }
}

export class HubCommandArtifactCleanupRuntimeSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  claim(input: HubCommandArtifactCleanupCycleClaimInput): HubCommandArtifactCleanupScheduleClaim {
    validateWorker(input.workerId);
    validateLeaseDuration(input.leaseDurationMs);
    const claimedAtMs = remoteCommandTimestamp(input.claimedAt, "cleanup runtime claimedAt");
    const row = this.database
      .prepare(
        `
      SELECT * FROM hub_remote_command_artifact_cleanup_runtime
      WHERE runtime_key = 'command_artifact_cleanup'
    `,
      )
      .get();
    if (row === undefined) {
      throw new HubCommandError(
        "artifact_integrity_failed",
        "The artifact cleanup runtime source is missing.",
      );
    }
    const leaseExpiresAtMs = row.lease_expires_at_ms;
    if (typeof leaseExpiresAtMs === "number" && leaseExpiresAtMs > claimedAtMs) {
      return {
        status: "waiting",
        reason: "leased",
        nextAttemptAt: stringField(row, "lease_expires_at"),
      };
    }
    const nextCycleAtMs = integerField(row, "next_cycle_at_ms");
    if (nextCycleAtMs > claimedAtMs) {
      return {
        status: "waiting",
        reason: "not_due",
        nextAttemptAt: stringField(row, "next_cycle_at"),
      };
    }
    const leaseId = `hcr_${randomBytes(24).toString("base64url")}`;
    const expiresAtMs = claimedAtMs + input.leaseDurationMs;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const updated = this.database
      .prepare(
        `
      UPDATE hub_remote_command_artifact_cleanup_runtime
      SET lease_id = ?, lease_owner = ?, lease_claimed_at = ?, lease_claimed_at_ms = ?,
        lease_expires_at = ?, lease_expires_at_ms = ?
      WHERE runtime_key = 'command_artifact_cleanup'
    `,
      )
      .run(leaseId, input.workerId, input.claimedAt, claimedAtMs, expiresAt, expiresAtMs);
    if (updated.changes !== 1) {
      throw new HubCommandError(
        "artifact_cleanup_conflict",
        "Could not acquire the artifact cleanup runtime lease.",
      );
    }
    return {
      status: "claimed",
      leaseId,
      inventoryCursor: nullableStringField(row, "inventory_cursor"),
      leaseExpiresAt: expiresAt,
    };
  }

  complete(input: HubCommandArtifactCleanupCycleCompletion): void {
    validateWorker(input.workerId);
    validateCursor(input.inventoryCursor);
    if (!/^hcr_[A-Za-z0-9_-]{32}$/u.test(input.leaseId)) {
      throw new HubCommandError(
        "invalid_request",
        "The artifact cleanup runtime lease ID is invalid.",
      );
    }
    const completedAtMs = remoteCommandTimestamp(input.completedAt, "cleanup runtime completedAt");
    const nextCycleAtMs = remoteCommandTimestamp(input.nextCycleAt, "cleanup runtime nextCycleAt");
    if (nextCycleAtMs < completedAtMs) {
      throw new HubCommandError(
        "invalid_request",
        "The next artifact cleanup run time is earlier than completion.",
      );
    }
    for (const value of [
      input.claimedCount,
      input.deletedCount,
      input.alreadyMissingCount,
      input.purgedDeliveryCount,
      input.orphanPurgedCount,
      input.failureCount,
    ])
      validateCount(value);
    if (
      input.deletedCount + input.alreadyMissingCount + input.failureCount !== input.claimedCount ||
      input.orphanPurgedCount > input.deletedCount + input.alreadyMissingCount ||
      input.purgedDeliveryCount >
        (input.deletedCount + input.alreadyMissingCount) * HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT ||
      (input.failureCount > 0 && !input.continuationRecommended)
    )
      throw new HubCommandError(
        "invalid_request",
        "The artifact cleanup result relation is invalid.",
      );
    const updated = this.database
      .prepare(
        `
      UPDATE hub_remote_command_artifact_cleanup_runtime
      SET inventory_cursor = ?, next_cycle_at = ?, next_cycle_at_ms = ?,
        lease_id = NULL, lease_owner = NULL, lease_claimed_at = NULL,
        lease_claimed_at_ms = NULL, lease_expires_at = NULL, lease_expires_at_ms = NULL,
        cycle_count = cycle_count + 1, last_cycle_at = ?, last_cycle_at_ms = ?,
        last_status = 'completed', last_failure_code = NULL,
        last_claimed_count = ?, last_deleted_count = ?, last_already_missing_count = ?,
        last_purged_delivery_count = ?, last_orphan_purged_count = ?, last_failure_count = ?,
        last_continuation_recommended = ?
      WHERE runtime_key = 'command_artifact_cleanup' AND lease_id = ? AND lease_owner = ?
        AND lease_claimed_at_ms <= ? AND lease_expires_at_ms >= ?
    `,
      )
      .run(
        input.inventoryCursor,
        input.nextCycleAt,
        nextCycleAtMs,
        input.completedAt,
        completedAtMs,
        input.claimedCount,
        input.deletedCount,
        input.alreadyMissingCount,
        input.purgedDeliveryCount,
        input.orphanPurgedCount,
        input.failureCount,
        input.continuationRecommended ? 1 : 0,
        input.leaseId,
        input.workerId,
        completedAtMs,
        completedAtMs,
      );
    if (updated.changes !== 1) {
      throw new HubCommandError(
        "artifact_cleanup_conflict",
        "The artifact cleanup runtime completion lease differs.",
      );
    }
  }

  fail(input: HubCommandArtifactCleanupCycleFailure): void {
    validateWorker(input.workerId);
    if (
      !/^hcr_[A-Za-z0-9_-]{32}$/u.test(input.leaseId) ||
      input.failureCode !== "artifact_cleanup_cycle_failed"
    ) {
      throw new HubCommandError(
        "invalid_request",
        "The artifact cleanup runtime failure coordinates are invalid.",
      );
    }
    const failedAtMs = remoteCommandTimestamp(input.failedAt, "cleanup runtime failedAt");
    const nextCycleAtMs = remoteCommandTimestamp(input.nextCycleAt, "cleanup runtime nextCycleAt");
    if (nextCycleAtMs < failedAtMs) {
      throw new HubCommandError(
        "invalid_request",
        "The artifact cleanup retry time is earlier than the failure.",
      );
    }
    const updated = this.database
      .prepare(
        `
      UPDATE hub_remote_command_artifact_cleanup_runtime
      SET next_cycle_at = ?, next_cycle_at_ms = ?, lease_id = NULL, lease_owner = NULL,
        lease_claimed_at = NULL, lease_claimed_at_ms = NULL,
        lease_expires_at = NULL, lease_expires_at_ms = NULL,
        cycle_count = cycle_count + 1, last_cycle_at = ?, last_cycle_at_ms = ?,
        last_status = 'failed', last_failure_code = ?, last_claimed_count = NULL,
        last_deleted_count = NULL, last_already_missing_count = NULL,
        last_purged_delivery_count = NULL, last_orphan_purged_count = NULL,
        last_failure_count = NULL, last_continuation_recommended = NULL
      WHERE runtime_key = 'command_artifact_cleanup' AND lease_id = ? AND lease_owner = ?
        AND lease_claimed_at_ms <= ? AND lease_expires_at_ms >= ?
    `,
      )
      .run(
        input.nextCycleAt,
        nextCycleAtMs,
        input.failedAt,
        failedAtMs,
        input.failureCode,
        input.leaseId,
        input.workerId,
        failedAtMs,
        failedAtMs,
      );
    if (updated.changes !== 1) {
      throw new HubCommandError(
        "artifact_cleanup_conflict",
        "The artifact cleanup runtime failure lease differs.",
      );
    }
  }
}
