import { type DatabaseSync } from "node:sqlite";

import {
  calculateHubCommandArtifactId,
  calculateHubCommandSubmissionHash,
  HubCommandError,
  type HubCommandAuthorshipRecord,
} from "@lervo/hub-command";
import {
  assertSignedRemoteCommand,
  calculateRemoteCommandDeliveryId,
} from "@lervo/remote-command-contract";
import type { RemoteCommandPayloadReference, RemoteCommandTarget } from "@lervo/schemas";

import { integerField, stringField, type SQLiteRow } from "./row-codec.js";
import { HubRemoteCommandSQLiteRepository } from "./remote-command-repository.js";
import { remoteCommandTimestamp } from "./remote-command-row.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

const UNRESOLVED_PARTIAL_CLEANUP_SQL = `EXISTS (
  SELECT 1 FROM hub_remote_command_artifact_gc_completions AS partial
  WHERE partial.artifact_uri = authorship.artifact_uri
    AND partial.completion_status = 'partial'
    AND NOT EXISTS (
      SELECT 1 FROM hub_remote_command_artifact_gc_completions AS completed
      WHERE completed.artifact_uri = partial.artifact_uri
        AND completed.completion_status = 'completed'
        AND completed.completed_at_ms >= partial.completed_at_ms
    )
)`;

function parseRecord(row: SQLiteRow): HubCommandAuthorshipRecord {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stringField(row, "envelope_json"));
    assertSignedRemoteCommand(envelope as never);
  } catch (error) {
    throw new HubCommandError(
      "artifact_integrity_failed",
      "The Hub command authorship source is invalid.",
      {
        cause: error,
      },
    );
  }
  const command = (envelope as HubCommandAuthorshipRecord["envelope"]).command;
  const lifecycleStatus = stringField(row, "artifact_lifecycle_status");
  if (!["retained", "cleanup_claimed", "purged"].includes(lifecycleStatus)) {
    throw new HubCommandError(
      "artifact_integrity_failed",
      "The Hub command artifact lifecycle state is invalid.",
    );
  }
  const record = {
    destinationId: stringField(row, "destination_id"),
    target: {
      projectId: stringField(row, "project_id"),
      projectIdentityHash: command.target.projectIdentityHash,
    },
    idempotencyKey: stringField(row, "idempotency_key"),
    submissionHash: stringField(row, "submission_hash"),
    authorSubjectHash: stringField(row, "author_subject_hash"),
    artifactUri: stringField(row, "artifact_uri"),
    artifactRetainUntil: stringField(row, "retain_until"),
    artifactLifecycleStatus:
      lifecycleStatus as HubCommandAuthorshipRecord["artifactLifecycleStatus"],
    envelope: structuredClone(envelope as HubCommandAuthorshipRecord["envelope"]),
    deliveryId: stringField(row, "delivery_id"),
    queuedAt: stringField(row, "queued_at"),
  };
  const lifetimeMs = Date.parse(command.expiresAt) - Date.parse(command.issuedAt);
  const artifactRetainUntilMs = Date.parse(record.artifactRetainUntil);
  if (
    record.target.projectId !== command.target.projectId ||
    record.idempotencyKey !== command.idempotencyKey ||
    record.deliveryId !==
      calculateRemoteCommandDeliveryId({
        destinationId: record.destinationId,
        envelope: record.envelope,
      }) ||
    record.submissionHash !==
      calculateHubCommandSubmissionHash({
        destinationId: record.destinationId,
        target: record.target,
        idempotencyKey: record.idempotencyKey,
        roleId: command.action.roleId,
        provider: command.action.provider,
        risk: command.action.risk,
        verificationSuiteIds: command.action.verificationSuiteIds,
        lifetimeMs,
        request: command.action.request,
        ...(command.action.continuation === undefined
          ? {}
          : { continuation: command.action.continuation }),
      }) ||
    !/^sha256:[a-f0-9]{64}$/.test(record.submissionHash) ||
    !/^sha256:[a-f0-9]{64}$/.test(record.authorSubjectHash) ||
    !Number.isFinite(artifactRetainUntilMs) ||
    artifactRetainUntilMs < Date.parse(command.expiresAt)
  )
    throw new HubCommandError(
      "artifact_integrity_failed",
      "The Hub command authorship coordinates differ from the source.",
    );
  return record;
}

export class HubCommandAuthorshipSQLiteRepository {
  private readonly commands: HubRemoteCommandSQLiteRepository;

  constructor(private readonly database: DatabaseSync) {
    this.commands = new HubRemoteCommandSQLiteRepository(database);
  }

  find(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    idempotencyKey: string;
  }): HubCommandAuthorshipRecord | null {
    const row = sqliteRow(
      this.database
        .prepare(
          `
      SELECT authorship.*, command.envelope_json, command.queued_at, retention.retain_until,
        CASE
          WHEN purge.delivery_id IS NOT NULL THEN 'purged'
          WHEN claim.claim_id IS NOT NULL OR ${UNRESOLVED_PARTIAL_CLEANUP_SQL}
            THEN 'cleanup_claimed'
          ELSE 'retained'
        END AS artifact_lifecycle_status
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      JOIN hub_remote_command_artifact_retentions AS retention
        ON retention.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_purges AS purge
        ON purge.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_gc_claims AS claim
        ON claim.artifact_uri = authorship.artifact_uri
      WHERE authorship.destination_id = ? AND authorship.project_id = ?
        AND authorship.idempotency_key = ?
    `,
        )
        .get(input.destinationId, input.target.projectId, input.idempotencyKey),
    );
    if (row === undefined) return null;
    const record = parseRecord(row);
    if (record.target.projectIdentityHash !== input.target.projectIdentityHash) {
      throw new HubCommandError(
        "idempotency_conflict",
        "The Hub command project identity differs from the current request.",
      );
    }
    return record;
  }

  commit(input: HubCommandAuthorshipRecord): {
    status: "created" | "duplicate";
    record: HubCommandAuthorshipRecord;
  } {
    const existing = this.find(input);
    if (existing !== null) {
      if (existing.submissionHash !== input.submissionHash) {
        throw new HubCommandError(
          "idempotency_conflict",
          "A different request exists for the same idempotency key.",
        );
      }
      return { status: "duplicate", record: existing };
    }
    const queuedAtMs = remoteCommandTimestamp(input.queuedAt, "artifact authorship queuedAt");
    const retainUntilMs = remoteCommandTimestamp(input.artifactRetainUntil, "artifact retainUntil");
    if (retainUntilMs < Date.parse(input.envelope.command.expiresAt)) {
      throw new HubCommandError(
        "invalid_request",
        "The artifact retention period is shorter than the command expiration.",
      );
    }
    this.database
      .prepare(
        `
      DELETE FROM hub_remote_command_artifact_gc_claims
      WHERE artifact_uri = ? AND lease_expires_at_ms <= ?
    `,
      )
      .run(input.artifactUri, queuedAtMs);
    if (
      sqliteRow(
        this.database
          .prepare(
            `
      SELECT 1 FROM hub_remote_command_artifact_gc_claims
      WHERE artifact_uri = ? AND lease_expires_at_ms > ?
      UNION ALL
      SELECT 1 FROM hub_remote_command_artifact_gc_completions AS partial
      WHERE partial.artifact_uri = ? AND partial.completion_status = 'partial'
        AND NOT EXISTS (
          SELECT 1 FROM hub_remote_command_artifact_gc_completions AS completed
          WHERE completed.artifact_uri = partial.artifact_uri
            AND completed.completion_status = 'completed'
            AND completed.completed_at_ms >= partial.completed_at_ms
        )
      LIMIT 1
    `,
          )
          .get(input.artifactUri, queuedAtMs, input.artifactUri),
      ) !== undefined
    ) {
      throw new HubCommandError(
        "artifact_cleanup_conflict",
        "The same artifact is being cleaned up. Retry the same request shortly.",
      );
    }
    const queued = this.commands.enqueue({
      destinationId: input.destinationId,
      envelope: input.envelope,
      queuedAt: input.queuedAt,
    });
    if (queued.deliveryId !== input.deliveryId) {
      throw new HubCommandError(
        "artifact_integrity_failed",
        "The Hub command delivery coordinates differ.",
      );
    }
    const reference = input.envelope.command.action.request;
    this.database
      .prepare(
        `
      INSERT INTO hub_remote_command_authorships (
        destination_id, project_id, idempotency_key, submission_hash,
        author_subject_hash, delivery_id, artifact_id, artifact_uri,
        content_hash, byte_count, media_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.destinationId,
        input.target.projectId,
        input.idempotencyKey,
        input.submissionHash,
        input.authorSubjectHash,
        input.deliveryId,
        reference.artifactId,
        input.artifactUri,
        reference.contentHash,
        reference.byteCount,
        reference.mediaType,
      );
    this.database
      .prepare(
        `
      INSERT INTO hub_remote_command_artifact_retentions (
        delivery_id, artifact_uri, retain_until, retain_until_ms
      ) VALUES (?, ?, ?, ?)
    `,
      )
      .run(input.deliveryId, input.artifactUri, input.artifactRetainUntil, retainUntilMs);
    return { status: "created", record: structuredClone(input) };
  }

  findLeasedArtifact(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    nodeId: string;
    artifactId: string;
    requestedAt: string;
  }): { uri: string; reference: RemoteCommandPayloadReference } | null {
    const requestedAtMs = remoteCommandTimestamp(input.requestedAt, "artifact requestedAt");
    const row = sqliteRow(
      this.database
        .prepare(
          `
      SELECT authorship.artifact_uri, authorship.artifact_id,
        authorship.content_hash, authorship.byte_count, authorship.media_type,
        project.identity_hash
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      JOIN hub_projects AS project
        ON project.destination_id = authorship.destination_id
       AND project.project_id = authorship.project_id
      WHERE authorship.destination_id = ? AND authorship.project_id = ?
        AND authorship.artifact_id = ? AND command.status = 'leased'
        AND command.lease_owner = ? AND command.lease_expires_at_ms > ?
        AND NOT EXISTS (
          SELECT 1 FROM hub_remote_command_artifact_purges AS purge
          WHERE purge.delivery_id = authorship.delivery_id
        )
    `,
        )
        .get(
          input.destinationId,
          input.target.projectId,
          input.artifactId,
          input.nodeId,
          requestedAtMs,
        ),
    );
    if (
      row === undefined ||
      stringField(row, "identity_hash") !== input.target.projectIdentityHash
    ) {
      return null;
    }
    return {
      uri: stringField(row, "artifact_uri"),
      reference: {
        artifactId: stringField(row, "artifact_id"),
        contentHash: stringField(row, "content_hash"),
        byteCount: integerField(row, "byte_count"),
        mediaType: stringField(row, "media_type") as "text/plain; charset=utf-8",
      },
    };
  }

  auditAll(): void {
    for (const row of sqliteRows(
      this.database
        .prepare(
          `
      SELECT authorship.*, command.envelope_json, command.queued_at, retention.retain_until,
        CASE
          WHEN purge.delivery_id IS NOT NULL THEN 'purged'
          WHEN claim.claim_id IS NOT NULL OR ${UNRESOLVED_PARTIAL_CLEANUP_SQL}
            THEN 'cleanup_claimed'
          ELSE 'retained'
        END AS artifact_lifecycle_status
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      JOIN hub_remote_command_artifact_retentions AS retention
        ON retention.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_purges AS purge
        ON purge.delivery_id = authorship.delivery_id
      LEFT JOIN hub_remote_command_artifact_gc_claims AS claim
        ON claim.artifact_uri = authorship.artifact_uri
      ORDER BY authorship.destination_id, authorship.project_id, authorship.idempotency_key
    `,
        )
        .all(),
    )) {
      const record = parseRecord(row);
      const reference = record.envelope.command.action.request;
      if (
        reference.artifactId !== stringField(row, "artifact_id") ||
        reference.artifactId !==
          calculateHubCommandArtifactId({
            destinationId: record.destinationId,
            target: record.target,
            contentHash: reference.contentHash,
          }) ||
        reference.contentHash !== stringField(row, "content_hash") ||
        reference.byteCount !== integerField(row, "byte_count") ||
        reference.mediaType !== stringField(row, "media_type")
      )
        throw new HubCommandError(
          "artifact_integrity_failed",
          "The Hub command artifact index differs from the source.",
        );
    }
  }
}
