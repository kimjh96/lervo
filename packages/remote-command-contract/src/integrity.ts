import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import {
  type RemoteCommand,
  type RemoteCommandExecutionReceipt,
  type SignedRemoteCommand,
  validateSchema,
} from "@lervo/schemas";

import { RemoteCommandContractError } from "./errors.js";

export type RemoteCommandContent = Omit<RemoteCommand, "commandId">;

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function commandIdentityContent(command: RemoteCommandContent): object {
  return clone(command);
}

export function calculateRemoteCommandId(content: RemoteCommandContent): string {
  return `rcm_${sha256(canonicalJson(commandIdentityContent(content))).slice("sha256:".length)}`;
}

export function createRemoteCommand(
  input: Omit<RemoteCommandContent, "schemaVersion">,
): RemoteCommand {
  const content: RemoteCommandContent = {
    schemaVersion: 1,
    ...clone(input),
  };
  const command: RemoteCommand = {
    ...content,
    commandId: calculateRemoteCommandId(content),
  };
  assertRemoteCommand(command);
  return clone(command);
}

export function assertRemoteCommand(command: RemoteCommand): void {
  if (!validateSchema("remoteCommand", command).valid) {
    throw new RemoteCommandContractError("invalid_command", "The remote command contract is invalid.");
  }
  const { commandId: _commandId, ...content } = command;
  if (command.commandId !== calculateRemoteCommandId(content)) {
    throw new RemoteCommandContractError(
      "invalid_command",
      "The remote command ID does not match the command source.",
    );
  }
  if (Date.parse(command.expiresAt) <= Date.parse(command.issuedAt)) {
    throw new RemoteCommandContractError(
      "invalid_command",
      "The remote command expiry time must follow its issue time.",
    );
  }
}

export function calculateRemoteCommandHash(command: RemoteCommand): string {
  assertRemoteCommand(command);
  return sha256(canonicalJson(command));
}

export function remoteCommandSigningBytes(input: {
  command: RemoteCommand;
  keyId: string;
}): Uint8Array {
  assertRemoteCommand(input.command);
  if (!/^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/.test(input.keyId)) {
    throw new RemoteCommandContractError(
      "invalid_signature_envelope",
      "The remote command signature key ID is invalid.",
    );
  }
  return Buffer.from(canonicalJson({
    domain: "lervo.remote-command.v1",
    algorithm: "ed25519",
    keyId: input.keyId,
    command: input.command,
  }), "utf8");
}

export function createSignedRemoteCommandEnvelope(input: {
  command: RemoteCommand;
  keyId: string;
  signature: Uint8Array;
}): SignedRemoteCommand {
  if (input.signature.byteLength !== 64) {
    throw new RemoteCommandContractError(
      "invalid_signature_envelope",
      "An Ed25519 signature must be 64 bytes.",
    );
  }
  const envelope: SignedRemoteCommand = {
    schemaVersion: 1,
    command: clone(input.command),
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      value: Buffer.from(input.signature).toString("base64url"),
    },
  };
  assertSignedRemoteCommand(envelope);
  return clone(envelope);
}

export function assertSignedRemoteCommand(envelope: SignedRemoteCommand): void {
  if (!validateSchema("signedRemoteCommand", envelope).valid) {
    throw new RemoteCommandContractError(
      "invalid_signature_envelope",
      "The signed remote command envelope is invalid.",
    );
  }
  assertRemoteCommand(envelope.command);
  const signature = Buffer.from(envelope.signature.value, "base64url");
  if (
    signature.byteLength !== 64 ||
    signature.toString("base64url") !== envelope.signature.value
  ) {
    throw new RemoteCommandContractError(
      "invalid_signature_envelope",
      "The remote command signature encoding is invalid.",
    );
  }
}

export function remoteCommandSignatureBytes(envelope: SignedRemoteCommand): Uint8Array {
  assertSignedRemoteCommand(envelope);
  return Buffer.from(envelope.signature.value, "base64url");
}

export function assertRemoteCommandExecutionReceipt(input: {
  command: RemoteCommand;
  receipt: RemoteCommandExecutionReceipt;
}): void {
  assertRemoteCommand(input.command);
  if (!validateSchema("remoteCommandExecutionReceipt", input.receipt).valid) {
    throw new RemoteCommandContractError(
      "invalid_execution_receipt",
      "The remote command execution receipt is invalid.",
    );
  }
  if (
    input.receipt.commandId !== input.command.commandId ||
    input.receipt.commandHash !== calculateRemoteCommandHash(input.command) ||
    input.receipt.idempotencyKey !== input.command.idempotencyKey
  ) {
    throw new RemoteCommandContractError(
      "invalid_execution_receipt",
      "The remote command execution receipt coordinates differ from the command.",
    );
  }
}
