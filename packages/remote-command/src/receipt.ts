import { createHash } from "node:crypto";

import { assertRemoteCommandExecutionReceipt } from "@lervo/remote-command-contract";
import {
  type RemoteCommand,
  type RemoteCommandExecutionReceipt,
  type RemoteCommandPayloadReference,
} from "@lervo/schemas";

import { RemoteCommandRuntimeError } from "./errors.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function assertStoredRemoteCommandReceipt(
  command: RemoteCommand,
  receipt: RemoteCommandExecutionReceipt,
): RemoteCommandExecutionReceipt {
  try {
    assertRemoteCommandExecutionReceipt({ command, receipt });
    return clone(receipt);
  } catch (error) {
    throw new RemoteCommandRuntimeError(
      "replay_store_failed",
      "저장된 remote command receipt가 command와 일치하지 않습니다.",
      { cause: error },
    );
  }
}

export function createFailedRemoteCommandReceipt(input: {
  command: RemoteCommand;
  commandHash: string;
  processedAt: string;
  failureCode: "payload_unavailable" | "payload_mismatch" | "execution_failed";
}): RemoteCommandExecutionReceipt {
  return {
    schemaVersion: 1,
    commandId: input.command.commandId,
    commandHash: input.commandHash,
    idempotencyKey: input.command.idempotencyKey,
    processedAt: input.processedAt,
    outcome: "failed",
    failureCode: input.failureCode,
  };
}

export function decodeRemoteCommandPayload(
  reference: RemoteCommandPayloadReference,
  bytes: Uint8Array,
): string | null {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== reference.byteCount ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== reference.contentHash
  ) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
