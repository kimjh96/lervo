import { type RemoteCommandReplayCoordinate } from "@lervo/remote-command";
import { type RemoteCommandExecutionReceipt, validateSchema } from "@lervo/schemas";

import { RemoteCommandSQLiteError } from "./errors.js";

export interface ReplayRow extends Record<string, unknown> {
  idempotency_key: string;
  command_hash: string;
  nonce: string;
  reservation_id: string;
  receipt_json: string | null;
}

export const REMOTE_COMMAND_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDEMPOTENCY_PATTERN = /^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export function assertReplayCoordinate(coordinate: RemoteCommandReplayCoordinate): void {
  if (
    !REMOTE_COMMAND_HASH_PATTERN.test(coordinate.commandHash) ||
    !IDEMPOTENCY_PATTERN.test(coordinate.idempotencyKey) ||
    !NONCE_PATTERN.test(coordinate.nonce)
  ) {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay coordinate is invalid.",
    );
  }
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay row is invalid.",
    );
  }
  return value;
}

function nullableStringField(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value !== null && typeof value !== "string") {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay row is invalid.",
    );
  }
  return value;
}

export function decodeReplayRow(row: Record<string, unknown>): ReplayRow {
  const decoded: ReplayRow = {
    idempotency_key: stringField(row, "idempotency_key"),
    command_hash: stringField(row, "command_hash"),
    nonce: stringField(row, "nonce"),
    reservation_id: stringField(row, "reservation_id"),
    receipt_json: nullableStringField(row, "receipt_json"),
  };
  assertReplayCoordinate({
    idempotencyKey: decoded.idempotency_key,
    commandHash: decoded.command_hash,
    nonce: decoded.nonce,
  });
  return decoded;
}

export function decodeReplayReceipt(row: ReplayRow): RemoteCommandExecutionReceipt | null {
  if (row.receipt_json === null) return null;
  let receipt: unknown;
  try {
    receipt = JSON.parse(row.receipt_json);
  } catch (error) {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay receipt JSON could not be read.",
      { cause: error },
    );
  }
  if (!validateSchema("remoteCommandExecutionReceipt", receipt).valid) {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay receipt does not match its coordinate.",
    );
  }
  const candidate = receipt as RemoteCommandExecutionReceipt;
  if (
    candidate.commandHash !== row.command_hash ||
    candidate.idempotencyKey !== row.idempotency_key
  ) {
    throw new RemoteCommandSQLiteError(
      "integrity_failed",
      "The remote command replay receipt does not match its coordinate.",
    );
  }
  return structuredClone(candidate);
}
