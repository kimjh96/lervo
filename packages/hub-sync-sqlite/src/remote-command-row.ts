import { type HubRemoteCommandDeliveryState } from "@lervo/hub-sync";
import {
  assertSignedRemoteCommand,
  calculateRemoteCommandHash,
} from "@lervo/remote-command-contract";
import { type SignedRemoteCommand } from "@lervo/schemas";

import { HubSyncStoreError } from "./errors.js";
import { parseJson, stringField, type SQLiteRow } from "./row-codec.js";

export function remoteCommandTimestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new HubSyncStoreError(
      "remote_command_conflict",
      `The remote command ${label} is invalid.`,
    );
  }
  return milliseconds;
}

export function parseStoredRemoteCommandEnvelope(row: SQLiteRow): SignedRemoteCommand {
  const envelope = parseJson(stringField(row, "envelope_json")) as SignedRemoteCommand;
  try {
    assertSignedRemoteCommand(envelope);
  } catch (error) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The Hub remote command envelope source is invalid.",
      { cause: error },
    );
  }
  if (
    envelope.command.commandId !== stringField(row, "command_id") ||
    calculateRemoteCommandHash(envelope.command) !== stringField(row, "command_hash")
  ) {
    throw new HubSyncStoreError(
      "integrity_failed",
      "The duplicate Hub remote command coordinates differ from the envelope.",
    );
  }
  return structuredClone(envelope);
}

export function parseRemoteCommandQueueStatus(
  value: string,
): HubRemoteCommandDeliveryState["status"] {
  if (!["pending", "leased", "completed", "rejected", "expired"].includes(value)) {
    throw new HubSyncStoreError("integrity_failed", "The Hub remote command state is invalid.");
  }
  return value as HubRemoteCommandDeliveryState["status"];
}
