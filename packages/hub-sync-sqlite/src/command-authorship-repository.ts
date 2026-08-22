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

function parseRecord(row: SQLiteRow): HubCommandAuthorshipRecord {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stringField(row, "envelope_json"));
    assertSignedRemoteCommand(envelope as never);
  } catch (error) {
    throw new HubCommandError("artifact_integrity_failed", "Hub command 작성 원본이 유효하지 않습니다.", {
      cause: error,
    });
  }
  const command = (envelope as HubCommandAuthorshipRecord["envelope"]).command;
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
    envelope: structuredClone(envelope as HubCommandAuthorshipRecord["envelope"]),
    deliveryId: stringField(row, "delivery_id"),
    queuedAt: stringField(row, "queued_at"),
  };
  const lifetimeMs = Date.parse(command.expiresAt) - Date.parse(command.issuedAt);
  if (
    record.target.projectId !== command.target.projectId ||
    record.idempotencyKey !== command.idempotencyKey ||
    record.deliveryId !== calculateRemoteCommandDeliveryId({
      destinationId: record.destinationId,
      envelope: record.envelope,
    }) ||
    record.submissionHash !== calculateHubCommandSubmissionHash({
      destinationId: record.destinationId,
      target: record.target,
      idempotencyKey: record.idempotencyKey,
      roleId: command.action.roleId,
      provider: command.action.provider,
      risk: command.action.risk,
      verificationSuiteIds: command.action.verificationSuiteIds,
      lifetimeMs,
      request: command.action.request,
    }) ||
    !/^sha256:[a-f0-9]{64}$/.test(record.submissionHash) ||
    !/^sha256:[a-f0-9]{64}$/.test(record.authorSubjectHash)
  ) throw new HubCommandError("artifact_integrity_failed", "Hub command authorship 좌표가 원본과 다릅니다.");
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
    const row = this.database.prepare(`
      SELECT authorship.*, command.envelope_json, command.queued_at
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      WHERE authorship.destination_id = ? AND authorship.project_id = ?
        AND authorship.idempotency_key = ?
    `).get(input.destinationId, input.target.projectId, input.idempotencyKey);
    if (row === undefined) return null;
    const record = parseRecord(row);
    if (record.target.projectIdentityHash !== input.target.projectIdentityHash) {
      throw new HubCommandError("idempotency_conflict", "Hub command project identity가 현재 요청과 다릅니다.");
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
        throw new HubCommandError("idempotency_conflict", "같은 idempotency key에 다른 요청이 있습니다.");
      }
      return { status: "duplicate", record: existing };
    }
    const queued = this.commands.enqueue({
      destinationId: input.destinationId,
      envelope: input.envelope,
      queuedAt: input.queuedAt,
    });
    if (queued.deliveryId !== input.deliveryId) {
      throw new HubCommandError("artifact_integrity_failed", "Hub command delivery 좌표가 다릅니다.");
    }
    const reference = input.envelope.command.action.request;
    this.database.prepare(`
      INSERT INTO hub_remote_command_authorships (
        destination_id, project_id, idempotency_key, submission_hash,
        author_subject_hash, delivery_id, artifact_id, artifact_uri,
        content_hash, byte_count, media_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    const row = this.database.prepare(`
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
    `).get(
      input.destinationId,
      input.target.projectId,
      input.artifactId,
      input.nodeId,
      requestedAtMs,
    );
    if (row === undefined || stringField(row, "identity_hash") !== input.target.projectIdentityHash) {
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
    for (const row of this.database.prepare(`
      SELECT authorship.*, command.envelope_json, command.queued_at
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
      ORDER BY authorship.destination_id, authorship.project_id, authorship.idempotency_key
    `).all()) {
      const record = parseRecord(row);
      const reference = record.envelope.command.action.request;
      const command = record.envelope.command;
      if (
        reference.artifactId !== stringField(row, "artifact_id") ||
        reference.artifactId !== calculateHubCommandArtifactId({
          destinationId: record.destinationId,
          target: record.target,
          contentHash: reference.contentHash,
        }) ||
        reference.contentHash !== stringField(row, "content_hash") ||
        reference.byteCount !== integerField(row, "byte_count") ||
        reference.mediaType !== stringField(row, "media_type")
      ) throw new HubCommandError("artifact_integrity_failed", "Hub command artifact index가 원본과 다릅니다.");
    }
  }
}
