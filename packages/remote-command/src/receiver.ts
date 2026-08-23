import {
  assertRemoteCommandExecutionReceipt,
  assertSignedRemoteCommand,
  calculateRemoteCommandHash,
  remoteCommandSignatureBytes,
  remoteCommandSigningBytes,
} from "@lervo/remote-command-contract";
import {
  type RemoteCommand,
  type RemoteCommandExecutionReceipt,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";

import { RemoteCommandRuntimeError } from "./errors.js";
import {
  assertStoredRemoteCommandReceipt,
  createFailedRemoteCommandReceipt,
  decodeRemoteCommandPayload,
} from "./receipt.js";
import {
  assertRemoteCommandTarget,
  isRemoteCommandTarget,
  parseRemoteCommandTimestamp,
  resolveRemoteCommandTiming,
  sameRemoteCommandTarget,
  systemRemoteCommandClock,
} from "./receiver-validation.js";
import { throwRemoteCommandReplayDecision } from "./replay-decision.js";
import {
  type RemoteCommandClock,
  type RemoteCommandHandlingResult,
  type RemoteCommandReceiverOptions,
  type RemoteCommandReplayCoordinate,
  type RemoteCommandReplayDecision,
  type RemoteCommandReservationDecision,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class RemoteCommandReceiver {
  private readonly target: RemoteCommandTarget;
  private readonly clock: RemoteCommandClock;
  private readonly maxLifetimeMs: number;
  private readonly clockSkewMs: number;

  constructor(private readonly options: RemoteCommandReceiverOptions) {
    assertRemoteCommandTarget(options.target);
    this.target = clone(options.target);
    this.clock = options.clock ?? systemRemoteCommandClock;
    const timing = resolveRemoteCommandTiming(options);
    this.maxLifetimeMs = timing.maxLifetimeMs;
    this.clockSkewMs = timing.clockSkewMs;
  }

  async handle(envelope: SignedRemoteCommand): Promise<RemoteCommandHandlingResult> {
    try {
      assertSignedRemoteCommand(envelope);
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "invalid_command",
        "The signed remote command does not satisfy the contract.",
        { cause: error },
      );
    }

    const command = envelope.command;
    const keyId = envelope.signature.keyId;
    let signer;
    try {
      signer = await this.options.trustStore.find(keyId);
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "trust_store_failed",
        "Could not query the remote command trust store.",
        { cause: error },
      );
    }
    if (signer === null) {
      throw new RemoteCommandRuntimeError("unknown_signer", "The remote command signer is not trusted.");
    }
    if (
      signer.keyId !== keyId ||
      typeof signer.verify !== "function" ||
      !Array.isArray(signer.projects) ||
      signer.projects.length < 1 ||
      signer.projects.length > 256 ||
      !signer.projects.every(isRemoteCommandTarget)
    ) {
      throw new RemoteCommandRuntimeError(
        "trust_store_failed",
        "The remote command trust store did not return a valid signer contract.",
      );
    }

    let verified = false;
    try {
      verified = await signer.verify({
        message: remoteCommandSigningBytes({ command, keyId }),
        signature: remoteCommandSignatureBytes(envelope),
      });
    } catch {
      verified = false;
    }
    if (!verified) {
      throw new RemoteCommandRuntimeError("invalid_signature", "Remote command signature verification failed.");
    }
    if (!signer.projects.some((project) => sameRemoteCommandTarget(project, command.target))) {
      throw new RemoteCommandRuntimeError(
        "signer_scope_denied",
        "The remote command signer is not authorized for the target project.",
      );
    }
    if (!sameRemoteCommandTarget(command.target, this.target)) {
      throw new RemoteCommandRuntimeError("target_mismatch", "The remote command target is not the current project.");
    }

    const commandHash = calculateRemoteCommandHash(command);
    const coordinate: RemoteCommandReplayCoordinate = {
      commandHash,
      idempotencyKey: command.idempotencyKey,
      nonce: command.nonce,
    };
    let inspected: RemoteCommandReplayDecision;
    try {
      inspected = await this.options.replayStore.inspect(coordinate);
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "replay_store_failed",
        "Could not query the remote command replay store.",
        { cause: error },
      );
    }
    if (inspected.status === "duplicate") {
      return {
        deliveryStatus: "duplicate",
        receipt: assertStoredRemoteCommandReceipt(command, inspected.receipt),
      };
    }
    if (inspected.status !== "available") throwRemoteCommandReplayDecision(inspected);

    const now = this.clock.now();
    const nowMs = parseRemoteCommandTimestamp(now, "receiver clock");
    const issuedAtMs = parseRemoteCommandTimestamp(command.issuedAt, "issuedAt");
    const expiresAtMs = parseRemoteCommandTimestamp(command.expiresAt, "expiresAt");
    if (expiresAtMs - issuedAtMs > this.maxLifetimeMs) {
      throw new RemoteCommandRuntimeError(
        "command_lifetime_exceeded",
        "The remote command validity period exceeds the local limit.",
      );
    }
    if (nowMs + this.clockSkewMs < issuedAtMs) {
      throw new RemoteCommandRuntimeError("command_not_yet_valid", "The remote command issue time has not arrived yet.");
    }
    if (nowMs - this.clockSkewMs > expiresAtMs) {
      throw new RemoteCommandRuntimeError("command_expired", "The remote command has expired.");
    }

    let policyDecision;
    try {
      policyDecision = await this.options.policy.authorize({
        command: clone(command),
        signerKeyId: keyId,
        evaluatedAt: now,
      });
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "policy_evaluation_failed",
        "Could not evaluate the local remote command policy.",
        { cause: error },
      );
    }
    if (policyDecision?.status === "denied" && typeof policyDecision.reasonCode === "string") {
      throw new RemoteCommandRuntimeError("policy_denied", "The remote command was denied by local policy.");
    }
    if (
      policyDecision?.status === "approval_required" &&
      typeof policyDecision.reasonCode === "string" &&
      typeof policyDecision.capability === "string"
    ) {
      throw new RemoteCommandRuntimeError(
        "approval_required",
        "Remote command execution requires verified approval.",
      );
    }
    if (policyDecision?.status !== "approved") {
      throw new RemoteCommandRuntimeError(
        "policy_evaluation_failed",
        "The local remote command policy result is invalid.",
      );
    }

    let reservation: RemoteCommandReservationDecision;
    try {
      reservation = await this.options.replayStore.reserve(coordinate);
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "replay_store_failed",
        "Could not create the remote command replay reservation.",
        { cause: error },
      );
    }
    if (reservation.status === "duplicate") {
      return {
        deliveryStatus: "duplicate",
        receipt: assertStoredRemoteCommandReceipt(command, reservation.receipt),
      };
    }
    if (reservation.status !== "reserved") throwRemoteCommandReplayDecision(reservation);

    let receipt: RemoteCommandExecutionReceipt;
    let payloadBytes: Uint8Array;
    try {
      payloadBytes = await this.options.payloadLoader.load(command.action.request);
    } catch {
      receipt = createFailedRemoteCommandReceipt({
        command,
        commandHash,
        processedAt: this.clock.now(),
        failureCode: "payload_unavailable",
      });
      return this.complete(reservation.reservationId, command, receipt);
    }

    const request = decodeRemoteCommandPayload(command.action.request, payloadBytes);
    if (request === null) {
      receipt = createFailedRemoteCommandReceipt({
        command,
        commandHash,
        processedAt: this.clock.now(),
        failureCode: "payload_mismatch",
      });
      return this.complete(reservation.reservationId, command, receipt);
    }

    try {
      const result = await this.options.executor.execute({
        command: clone(command),
        request,
        authorizedAt: now,
        policyAuthorization: policyDecision.authorization === undefined
          ? null
          : clone(policyDecision.authorization),
        approvedRepositoryPaths: Array.isArray(policyDecision.approvedRepositoryPaths)
          ? [...policyDecision.approvedRepositoryPaths]
          : [],
      });
      receipt = {
        schemaVersion: 1,
        commandId: command.commandId,
        commandHash,
        idempotencyKey: command.idempotencyKey,
        processedAt: result.completedAt,
        outcome: "executed",
        runId: result.runId,
      };
      assertRemoteCommandExecutionReceipt({ command, receipt });
    } catch {
      receipt = createFailedRemoteCommandReceipt({
        command,
        commandHash,
        processedAt: this.clock.now(),
        failureCode: "execution_failed",
      });
    }
    return this.complete(reservation.reservationId, command, receipt);
  }

  private async complete(
    reservationId: string,
    command: RemoteCommand,
    receipt: RemoteCommandExecutionReceipt,
  ): Promise<RemoteCommandHandlingResult> {
    try {
      assertRemoteCommandExecutionReceipt({ command, receipt });
      await this.options.replayStore.complete({ reservationId, receipt });
    } catch (error) {
      throw new RemoteCommandRuntimeError(
        "replay_store_failed",
        "Could not complete the remote command receipt in the replay store.",
        { cause: error },
      );
    }
    return { deliveryStatus: "processed", receipt: clone(receipt) };
  }
}
