import { type DatabaseSync } from "node:sqlite";

import {
  HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT,
  HubCommandError,
} from "@lervo/hub-command";

import { integerField, nullableStringField, stringField } from "./row-codec.js";
import { remoteCommandTimestamp } from "./remote-command-row.js";

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const CURSOR_PATTERN = /^lervo-cas:\/\/sha256\/[a-f0-9]{64}$/u;

function indexedTimestamp(row: Record<string, unknown>, field: string): number {
  const milliseconds = remoteCommandTimestamp(stringField(row, field), `cleanup runtime ${field}`);
  if (milliseconds !== integerField(row, `${field}_ms`)) {
    throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime time index differs.");
  }
  return milliseconds;
}

export function auditCommandArtifactCleanupRuntime(database: DatabaseSync): void {
  const rows = database.prepare(
    "SELECT * FROM hub_remote_command_artifact_cleanup_runtime",
  ).all();
  if (rows.length !== 1) {
    throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime singleton is invalid.");
  }
  const row = rows[0]!;
  const cursor = nullableStringField(row, "inventory_cursor");
  if (cursor !== null && !CURSOR_PATTERN.test(cursor)) {
    throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime cursor is invalid.");
  }
  const nextCycleAtMs = indexedTimestamp(row, "next_cycle_at");
  const leaseId = nullableStringField(row, "lease_id");
  let leaseClaimedAtMs: number | null = null;
  if (leaseId !== null) {
    const owner = stringField(row, "lease_owner");
    leaseClaimedAtMs = indexedTimestamp(row, "lease_claimed_at");
    if (!/^hcr_[A-Za-z0-9_-]{32}$/u.test(leaseId) || !WORKER_PATTERN.test(owner) ||
      indexedTimestamp(row, "lease_expires_at") <= leaseClaimedAtMs) {
      throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime lease is invalid.");
    }
  }
  const cycleCount = integerField(row, "cycle_count");
  const status = nullableStringField(row, "last_status");
  if ((cycleCount === 0) !== (status === null)) {
    throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime cycle source is invalid.");
  }
  if (status !== null) {
    const lastCycleAtMs = indexedTimestamp(row, "last_cycle_at");
    if (nextCycleAtMs < lastCycleAtMs ||
      (leaseClaimedAtMs !== null && leaseClaimedAtMs < lastCycleAtMs)) {
      throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime time moved backwards.");
    }
    if (status !== "completed" && status !== "failed") {
      throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime state is invalid.");
    }
  }
  if (status === "completed") {
    const claimed = integerField(row, "last_claimed_count");
    const deleted = integerField(row, "last_deleted_count");
    const missing = integerField(row, "last_already_missing_count");
    const failures = integerField(row, "last_failure_count");
    const orphanPurged = integerField(row, "last_orphan_purged_count");
    const purgedDeliveries = integerField(row, "last_purged_delivery_count");
    const continuation = integerField(row, "last_continuation_recommended");
    if (
      deleted + missing + failures !== claimed || orphanPurged > deleted + missing ||
      purgedDeliveries >
        (deleted + missing) * HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT ||
      (failures > 0 && continuation !== 1)
    ) {
      throw new HubCommandError("artifact_integrity_failed", "The artifact cleanup runtime result relation is invalid.");
    }
  }
}
