import { type DatabaseSync } from "node:sqlite";

import {
  HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT,
  HubCommandError,
} from "@lervo/hub-command";

import { integerField, stringField } from "./row-codec.js";
import { remoteCommandTimestamp } from "./remote-command-row.js";

const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const URI_PATTERN = /^lervo-cas:\/\/sha256\/[a-f0-9]{64}$/u;

export function auditCommandArtifactLifecycle(database: DatabaseSync): void {
  const invalidRetention = database.prepare(`
    SELECT 1
    FROM hub_remote_command_authorships AS authorship
    JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
    LEFT JOIN hub_remote_command_artifact_retentions AS retention
      ON retention.delivery_id = authorship.delivery_id
    WHERE retention.delivery_id IS NULL
      OR retention.artifact_uri <> authorship.artifact_uri
      OR retention.retain_until_ms < command.expires_at_ms
      OR strftime('%s', retention.retain_until) IS NULL
      OR ABS(
        retention.retain_until_ms - CAST(strftime('%s', retention.retain_until) AS INTEGER) * 1000
      ) >= 1000
    LIMIT 1
  `).get();
  if (invalidRetention !== undefined) {
    throw new HubCommandError("artifact_integrity_failed", "artifact 수명주기 index가 원본과 다릅니다.");
  }
  const invalidPurge = database.prepare(`
    SELECT 1
    FROM hub_remote_command_artifact_purges AS purge
    JOIN hub_remote_command_authorships AS authorship
      ON authorship.delivery_id = purge.delivery_id
    LEFT JOIN hub_remote_command_artifact_gc_completions AS completion
      ON completion.claim_id = purge.claim_id
    WHERE purge.artifact_uri <> authorship.artifact_uri
      OR completion.claim_id IS NULL OR completion.kind <> 'expired'
      OR completion.artifact_uri <> purge.artifact_uri
    LIMIT 1
  `).get();
  const invalidCompletion = database.prepare(`
    SELECT 1
    FROM hub_remote_command_artifact_gc_completions AS completion
    LEFT JOIN hub_remote_command_artifact_purges AS purge
      ON purge.claim_id = completion.claim_id
    GROUP BY completion.claim_id
    HAVING
      (completion.kind = 'orphan' AND (
        completion.completion_status <> 'completed' OR
        COUNT(purge.delivery_id) <> 0 OR completion.purged_delivery_count <> 0
      )) OR
      (completion.kind = 'expired' AND (
        COUNT(purge.delivery_id) = 0 OR
        COUNT(purge.delivery_id) <> completion.purged_delivery_count OR
        completion.purged_delivery_count > ${HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT} OR
        (completion.completion_status = 'partial' AND
          completion.purged_delivery_count <> ${HUB_COMMAND_ARTIFACT_PURGE_BATCH_LIMIT})
      ))
    LIMIT 1
  `).get();
  const completedClaim = database.prepare(`
    SELECT 1
    FROM hub_remote_command_artifact_gc_claims AS claim
    JOIN hub_remote_command_artifact_gc_completions AS completion
      ON completion.claim_id = claim.claim_id
    LIMIT 1
  `).get();
  if (
    invalidPurge !== undefined || invalidCompletion !== undefined ||
    completedClaim !== undefined
  ) throw new HubCommandError("artifact_integrity_failed", "artifact 정리 원본 관계가 유효하지 않습니다.");

  for (const row of database.prepare(`
    SELECT artifact_uri, claim_id, kind, worker_id, claimed_at, claimed_at_ms,
      lease_expires_at, lease_expires_at_ms, observed_modified_at,
      observed_modified_at_ms
    FROM hub_remote_command_artifact_gc_claims
  `).all()) {
    const kind = stringField(row, "kind");
    const observedAt = row.observed_modified_at;
    const observedAtMs = row.observed_modified_at_ms;
    if (
      !URI_PATTERN.test(stringField(row, "artifact_uri")) ||
      !/^hcg_[A-Za-z0-9_-]{32}$/u.test(stringField(row, "claim_id")) ||
      !WORKER_PATTERN.test(stringField(row, "worker_id")) ||
      !["expired", "orphan"].includes(kind) ||
      remoteCommandTimestamp(stringField(row, "claimed_at"), "artifact claimedAt") !==
        integerField(row, "claimed_at_ms") ||
      remoteCommandTimestamp(stringField(row, "lease_expires_at"), "artifact leaseExpiresAt") !==
        integerField(row, "lease_expires_at_ms") ||
      (kind === "orphan" && (
        typeof observedAt !== "string" || typeof observedAtMs !== "number" ||
        remoteCommandTimestamp(observedAt, "artifact observedModifiedAt") !== observedAtMs
      ))
    ) throw new HubCommandError("artifact_integrity_failed", "artifact cleanup claim이 유효하지 않습니다.");
  }

  for (const row of database.prepare(`
    SELECT claim_id, artifact_uri, worker_id, completed_at, completed_at_ms,
      completion_status
    FROM hub_remote_command_artifact_gc_completions
    UNION ALL
    SELECT claim_id, artifact_uri, '' AS worker_id, purged_at AS completed_at,
      purged_at_ms AS completed_at_ms, 'completed' AS completion_status
    FROM hub_remote_command_artifact_purges
  `).all()) {
    const workerId = stringField(row, "worker_id");
    const completionStatus = stringField(row, "completion_status");
    if (
      !/^hcg_[A-Za-z0-9_-]{32}$/u.test(stringField(row, "claim_id")) ||
      !URI_PATTERN.test(stringField(row, "artifact_uri")) ||
      (workerId !== "" && !WORKER_PATTERN.test(workerId)) ||
      !["completed", "partial"].includes(completionStatus) ||
      remoteCommandTimestamp(stringField(row, "completed_at"), "artifact lifecycle timestamp") !==
        integerField(row, "completed_at_ms")
    ) throw new HubCommandError("artifact_integrity_failed", "artifact 정리 완료 원본이 유효하지 않습니다.");
  }
}
