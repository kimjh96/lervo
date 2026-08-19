import { randomBytes } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";

import { canonicalJson } from "@lervo/event-contract";
import {
  type HubRemoteCommandDeliveryState,
  type HubRemoteCommandEnqueueResult,
} from "@lervo/hub-sync";
import {
  assertRemoteCommandDeliveryAcknowledgement,
  assertSignedRemoteCommand,
  calculateRemoteCommandAcknowledgementHash,
  calculateRemoteCommandDeliveryId,
  calculateRemoteCommandHash,
  createRemoteCommandDeliveryConfirmation,
  createRemoteCommandLease,
} from "@lervo/remote-command-contract";
import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandDeliveryConfirmation,
  type RemoteCommandLease,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import { HubRemoteCommandQuerySQLiteRepository } from "./remote-command-query-repository.js";
import {
  nullableStringField,
  stringField,
} from "./row-codec.js";
import {
  parseRemoteCommandQueueStatus,
  parseStoredRemoteCommandEnvelope,
  remoteCommandTimestamp,
} from "./remote-command-row.js";

export class HubRemoteCommandSQLiteRepository {
  private readonly query: HubRemoteCommandQuerySQLiteRepository;

  constructor(private readonly database: DatabaseSync) {
    this.query = new HubRemoteCommandQuerySQLiteRepository(database);
  }

  enqueue(input: {
    destinationId: string;
    envelope: SignedRemoteCommand;
    queuedAt: string;
  }): HubRemoteCommandEnqueueResult {
    assertSignedRemoteCommand(input.envelope);
    const command = input.envelope.command;
    const registration = this.database.prepare(`
      SELECT identity_hash FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `).get(input.destinationId, command.target.projectId);
    if (registration === undefined) {
      throw new HubSyncStoreError(
        "remote_command_registration_required",
        "remote command target project가 Hub에 등록되지 않았습니다.",
      );
    }
    if (stringField(registration, "identity_hash") !== command.target.projectIdentityHash) {
      throw new HubSyncStoreError(
        "remote_command_identity_mismatch",
        "remote command target identity가 Hub registration과 다릅니다.",
      );
    }
    const queuedAtMs = remoteCommandTimestamp(input.queuedAt, "queuedAt");
    const issuedAtMs = remoteCommandTimestamp(command.issuedAt, "issuedAt");
    const expiresAtMs = remoteCommandTimestamp(command.expiresAt, "expiresAt");
    if (queuedAtMs >= expiresAtMs) {
      throw new HubSyncStoreError(
        "remote_command_conflict",
        "만료된 remote command는 Hub queue에 저장할 수 없습니다.",
      );
    }

    const deliveryId = calculateRemoteCommandDeliveryId({
      destinationId: input.destinationId,
      envelope: input.envelope,
    });
    const existing = this.database.prepare(`
      SELECT delivery_id, envelope_json, status, queued_at
      FROM hub_remote_commands
      WHERE delivery_id = ? OR (
        destination_id = ? AND project_id = ? AND command_id = ?
      )
    `).all(
      deliveryId,
      input.destinationId,
      command.target.projectId,
      command.commandId,
    );
    if (existing.length !== 0) {
      if (
        existing.length !== 1 ||
        stringField(existing[0]!, "delivery_id") !== deliveryId ||
        stringField(existing[0]!, "envelope_json") !== canonicalJson(input.envelope)
      ) {
        throw new HubSyncStoreError(
          "remote_command_conflict",
          "같은 remote command 좌표에 다른 envelope이 이미 있습니다.",
        );
      }
      return {
        status: "duplicate",
        deliveryId,
        commandId: command.commandId,
        queueStatus: parseRemoteCommandQueueStatus(stringField(existing[0]!, "status")),
        queuedAt: stringField(existing[0]!, "queued_at"),
      };
    }

    this.database.prepare(`
      INSERT INTO hub_remote_commands (
        delivery_id, destination_id, project_id, command_id, command_hash,
        envelope_json, queued_at, queued_at_ms, issued_at, issued_at_ms,
        expires_at, expires_at_ms, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      deliveryId,
      input.destinationId,
      command.target.projectId,
      command.commandId,
      calculateRemoteCommandHash(command),
      canonicalJson(input.envelope),
      input.queuedAt,
      queuedAtMs,
      command.issuedAt,
      issuedAtMs,
      command.expiresAt,
      expiresAtMs,
    );
    return {
      status: "queued",
      deliveryId,
      commandId: command.commandId,
      queueStatus: "pending",
      queuedAt: input.queuedAt,
    };
  }

  lease(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    leasedTo: string;
    leasedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): RemoteCommandLease[] {
    const leasedAtMs = remoteCommandTimestamp(input.leasedAt, "leasedAt");
    const registration = this.database.prepare(`
      SELECT identity_hash FROM hub_projects
      WHERE destination_id = ? AND project_id = ?
    `).get(input.destinationId, input.target.projectId);
    if (registration === undefined) {
      throw new HubSyncStoreError(
        "remote_command_registration_required",
        "remote command lease project가 Hub에 등록되지 않았습니다.",
      );
    }
    if (stringField(registration, "identity_hash") !== input.target.projectIdentityHash) {
      throw new HubSyncStoreError(
        "remote_command_identity_mismatch",
        "remote command lease identity가 Hub registration과 다릅니다.",
      );
    }

    this.database.prepare(`
      UPDATE hub_remote_commands
      SET status = 'pending', lease_id = NULL, lease_owner = NULL,
          leased_at = NULL, lease_expires_at = NULL, lease_expires_at_ms = NULL
      WHERE destination_id = ? AND project_id = ? AND status = 'leased'
        AND lease_expires_at_ms <= ?
    `).run(input.destinationId, input.target.projectId, leasedAtMs);
    this.database.prepare(`
      UPDATE hub_remote_commands
      SET status = 'expired', terminal_at = ?
      WHERE destination_id = ? AND project_id = ? AND status = 'pending'
        AND expires_at_ms <= ?
    `).run(input.leasedAt, input.destinationId, input.target.projectId, leasedAtMs);

    const rows = this.database.prepare(`
      SELECT delivery_id, command_id, command_hash, envelope_json, expires_at
      FROM hub_remote_commands
      WHERE destination_id = ? AND project_id = ? AND status = 'pending'
        AND issued_at_ms <= ?
      ORDER BY queued_at_ms ASC, delivery_id ASC
      LIMIT ?
    `).all(input.destinationId, input.target.projectId, leasedAtMs, input.limit);
    return rows.map((row) => {
      const envelope = parseStoredRemoteCommandEnvelope(row);
      const leaseId = `rcl_${randomBytes(32).toString("base64url")}`;
      const leaseExpiresAtMs = Math.min(
        leasedAtMs + input.leaseDurationMs,
        Date.parse(stringField(row, "expires_at")),
      );
      const leaseExpiresAt = new Date(leaseExpiresAtMs).toISOString();
      const result = this.database.prepare(`
        UPDATE hub_remote_commands
        SET status = 'leased', attempt_count = attempt_count + 1,
            lease_id = ?, lease_owner = ?, leased_at = ?, lease_expires_at = ?,
            lease_expires_at_ms = ?
        WHERE delivery_id = ? AND status = 'pending'
      `).run(
        leaseId,
        input.leasedTo,
        input.leasedAt,
        leaseExpiresAt,
        leaseExpiresAtMs,
        stringField(row, "delivery_id"),
      );
      if (result.changes !== 1) {
        throw new HubSyncStoreError(
          "write_failed",
          "Hub remote command lease를 원자적으로 예약하지 못했습니다.",
        );
      }
      return createRemoteCommandLease({
        destinationId: input.destinationId,
        leaseId,
        leasedTo: input.leasedTo,
        leasedAt: input.leasedAt,
        leaseExpiresAt,
        envelope,
      });
    });
  }

  acknowledge(input: {
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
    confirmedAt: string;
  }): RemoteCommandDeliveryConfirmation {
    const acknowledgementHash = calculateRemoteCommandAcknowledgementHash(input.acknowledgement);
    const row = this.database.prepare(`
      SELECT delivery_id, destination_id, command_id, command_hash, envelope_json,
        status, lease_id, lease_owner, leased_at, lease_expires_at,
        acknowledgement_hash
      FROM hub_remote_commands WHERE delivery_id = ?
    `).get(input.acknowledgement.deliveryId);
    if (row === undefined) {
      throw new HubSyncStoreError(
        "remote_command_ack_invalid",
        "remote command acknowledgement 대상이 없습니다.",
      );
    }
    const status = parseRemoteCommandQueueStatus(stringField(row, "status"));
    if (status === "completed" || status === "rejected") {
      if (nullableStringField(row, "acknowledgement_hash") !== acknowledgementHash) {
        throw new HubSyncStoreError(
          "remote_command_ack_invalid",
          "terminal remote command에 다른 acknowledgement가 도착했습니다.",
        );
      }
      return createRemoteCommandDeliveryConfirmation({
        acknowledgement: input.acknowledgement,
        status: "duplicate",
        confirmedAt: input.confirmedAt,
      });
    }
    if (
      status !== "leased" ||
      nullableStringField(row, "lease_id") !== input.acknowledgement.leaseId ||
      stringField(row, "command_id") !== input.acknowledgement.commandId ||
      stringField(row, "command_hash") !== input.acknowledgement.commandHash
    ) {
      throw new HubSyncStoreError(
        "remote_command_ack_invalid",
        "remote command acknowledgement가 현재 lease와 다릅니다.",
      );
    }
    const envelope = parseStoredRemoteCommandEnvelope(row);
    const lease = createRemoteCommandLease({
      destinationId: stringField(row, "destination_id"),
      leaseId: input.acknowledgement.leaseId,
      leasedTo: stringField(row, "lease_owner"),
      leasedAt: stringField(row, "leased_at"),
      leaseExpiresAt: stringField(row, "lease_expires_at"),
      envelope,
    });
    try {
      assertRemoteCommandDeliveryAcknowledgement({
        lease,
        acknowledgement: input.acknowledgement,
      });
    } catch (error) {
      throw new HubSyncStoreError(
        "remote_command_ack_invalid",
        "remote command acknowledgement 계약이 현재 lease와 다릅니다.",
        { cause: error },
      );
    }
    const terminalStatus = input.acknowledgement.disposition === "completed"
      ? "completed"
      : "rejected";
    const updated = this.database.prepare(`
      UPDATE hub_remote_commands
      SET status = ?, lease_id = NULL, lease_owner = NULL, leased_at = NULL,
          lease_expires_at = NULL, lease_expires_at_ms = NULL, acknowledgement_json = ?,
          acknowledgement_hash = ?, terminal_at = ?
      WHERE delivery_id = ? AND status = 'leased'
    `).run(
      terminalStatus,
      canonicalJson(input.acknowledgement),
      acknowledgementHash,
      input.confirmedAt,
      input.acknowledgement.deliveryId,
    );
    if (updated.changes !== 1) {
      throw new HubSyncStoreError(
        "write_failed",
        "Hub remote command acknowledgement를 원자적으로 완료하지 못했습니다.",
      );
    }
    return createRemoteCommandDeliveryConfirmation({
      acknowledgement: input.acknowledgement,
      status: "accepted",
      confirmedAt: input.confirmedAt,
    });
  }

  get(deliveryId: string): HubRemoteCommandDeliveryState | null {
    return this.query.get(deliveryId);
  }

  auditAll(): void {
    this.query.auditAll();
  }
}
