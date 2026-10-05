import { type DatabaseSync } from "node:sqlite";

import { type HubRemoteCommandDeliveryState } from "@lervo/hub-sync";
import {
  assertRemoteCommandExecutionReceipt,
  calculateRemoteCommandAcknowledgementHash,
  calculateRemoteCommandDeliveryId,
  calculateRemoteCommandHash,
} from "@lervo/remote-command-contract";
import { type RemoteCommandDeliveryAcknowledgement } from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import {
  parseRemoteCommandQueueStatus,
  parseStoredRemoteCommandEnvelope,
  remoteCommandTimestamp,
} from "./remote-command-row.js";
import { integerField, nullableStringField, stringField } from "./row-codec.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";

export class HubRemoteCommandQuerySQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  get(deliveryId: string): HubRemoteCommandDeliveryState | null {
    const row = sqliteRow(
      this.database
        .prepare(
          `
      SELECT delivery_id, destination_id, project_id, command_id, command_hash,
        envelope_json, status, attempt_count, queued_at, queued_at_ms,
        issued_at, issued_at_ms, expires_at, expires_at_ms,
        acknowledgement_json, acknowledgement_hash, terminal_at
      FROM hub_remote_commands WHERE delivery_id = ?
    `,
        )
        .get(deliveryId),
    );
    if (row === undefined) return null;
    const envelope = parseStoredRemoteCommandEnvelope(row);
    const destinationId = stringField(row, "destination_id");
    if (
      calculateRemoteCommandDeliveryId({ destinationId, envelope }) !== deliveryId ||
      envelope.command.target.projectId !== stringField(row, "project_id") ||
      envelope.command.issuedAt !== stringField(row, "issued_at") ||
      envelope.command.expiresAt !== stringField(row, "expires_at") ||
      remoteCommandTimestamp(stringField(row, "queued_at"), "stored queuedAt") !==
        integerField(row, "queued_at_ms") ||
      Date.parse(envelope.command.issuedAt) !== integerField(row, "issued_at_ms") ||
      Date.parse(envelope.command.expiresAt) !== integerField(row, "expires_at_ms")
    ) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub remote command delivery coordinates differ from the source envelope.",
      );
    }
    const status = parseRemoteCommandQueueStatus(stringField(row, "status"));
    if (status === "completed" || status === "rejected") {
      this.assertTerminalAcknowledgement({
        row,
        deliveryId,
        status,
        command: envelope.command,
      });
    }
    return {
      deliveryId: stringField(row, "delivery_id"),
      destinationId,
      commandId: stringField(row, "command_id"),
      commandHash: stringField(row, "command_hash"),
      target: structuredClone(envelope.command.target),
      status,
      attemptCount: integerField(row, "attempt_count"),
      queuedAt: stringField(row, "queued_at"),
      expiresAt: stringField(row, "expires_at"),
      terminalAt: nullableStringField(row, "terminal_at"),
    };
  }

  private assertTerminalAcknowledgement(input: {
    row: Record<string, unknown>;
    deliveryId: string;
    status: "completed" | "rejected";
    command: ReturnType<typeof parseStoredRemoteCommandEnvelope>["command"];
  }): void {
    const acknowledgementJson = nullableStringField(input.row, "acknowledgement_json");
    const acknowledgementHash = nullableStringField(input.row, "acknowledgement_hash");
    let acknowledgement: unknown;
    try {
      acknowledgement = JSON.parse(acknowledgementJson ?? "");
    } catch (error) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub remote command acknowledgement source cannot be read.",
        { cause: error },
      );
    }
    try {
      const candidate = acknowledgement as RemoteCommandDeliveryAcknowledgement;
      if (
        candidate.commandId !== input.command.commandId ||
        candidate.deliveryId !== input.deliveryId ||
        candidate.commandHash !== calculateRemoteCommandHash(input.command) ||
        calculateRemoteCommandAcknowledgementHash(candidate) !== acknowledgementHash ||
        (input.status === "completed") !== (candidate.disposition === "completed")
      ) {
        throw new Error("terminal acknowledgement coordinates differ");
      }
      if (candidate.disposition === "completed") {
        assertRemoteCommandExecutionReceipt({
          command: input.command,
          receipt: candidate.receipt,
        });
      }
    } catch (error) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub remote command terminal acknowledgement differs from the source.",
        { cause: error },
      );
    }
  }

  auditAll(): void {
    const rows = sqliteRows(
      this.database
        .prepare(
          `
      SELECT delivery_id FROM hub_remote_commands ORDER BY delivery_id ASC
    `,
        )
        .all(),
    );
    for (const row of rows) {
      const deliveryId = stringField(row, "delivery_id");
      if (this.get(deliveryId) === null) {
        throw new HubSyncStoreError("integrity_failed", "The Hub remote command audit failed.");
      }
    }
  }
}
