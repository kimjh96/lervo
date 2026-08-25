import {
  assertRemoteCommandDeliveryConfirmation,
  assertRemoteCommandLease,
  createCompletedRemoteCommandAcknowledgement,
  createRejectedRemoteCommandAcknowledgement,
} from "@lervo/remote-command-contract";
import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandDeliveryConfirmation,
  type RemoteCommandLease,
  type RemoteCommandTarget,
} from "@lervo/schemas";

import {
  type AuthenticatedRemoteCommandHubTransport,
  authenticatedRemoteCommandBody,
  RemoteCommandDeliveryError,
  type RemoteCommandDeliveryErrorCode,
} from "./delivery-transport.js";
import { RemoteCommandRuntimeError, type RemoteCommandRuntimeErrorCode } from "./errors.js";
import { type RemoteCommandClock, type RemoteCommandHandler } from "./types.js";

const TERMINAL_REJECTIONS = new Set<RemoteCommandRuntimeErrorCode>([
  "invalid_command",
  "unknown_signer",
  "invalid_signature",
  "signer_scope_denied",
  "target_mismatch",
  "command_expired",
  "command_lifetime_exceeded",
  "idempotency_conflict",
  "nonce_replay",
]);

type RejectionCode = Extract<
  RemoteCommandDeliveryAcknowledgement,
  { disposition: "rejected" }
>["rejectionCode"];

export interface RemoteCommandReconnectWorkerOptions {
  destinationId: string;
  expectedPeerIdentityHash: string;
  nodeId: string;
  target: RemoteCommandTarget;
  transport: AuthenticatedRemoteCommandHubTransport;
  handler: RemoteCommandHandler;
  clock?: RemoteCommandClock;
  leaseDurationMs?: number;
  retryDelayMs?: number;
  limit?: number;
}

export type RemoteCommandReconnectCycleResult =
  | {
      status: "offline";
      failureCode: RemoteCommandDeliveryErrorCode;
      nextAttemptAt: string;
      leasedCount: 0;
      acknowledgedCount: 0;
    }
  | {
      status: "idle";
      leasedCount: 0;
      acknowledgedCount: 0;
    }
  | {
      status: "processed";
      leasedCount: number;
      acknowledgedCount: number;
      executedCount: number;
      failedCount: number;
      duplicateCount: number;
      rejectedCount: number;
    }
  | {
      status: "acknowledgement_pending";
      failureCode: RemoteCommandDeliveryErrorCode;
      nextAttemptAt: string;
      leasedCount: number;
      acknowledgedCount: number;
    }
  | {
      status: "local_deferred";
      failureCode: RemoteCommandRuntimeErrorCode;
      nextAttemptAt: string;
      leasedCount: number;
      acknowledgedCount: number;
    };

const systemClock: RemoteCommandClock = { now: () => new Date().toISOString() };

function sameTarget(left: RemoteCommandTarget, right: RemoteCommandTarget): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function timestamp(clock: RemoteCommandClock): { value: string; milliseconds: number } {
  const value = clock.now();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      "The remote command reconnect clock is invalid.",
    );
  }
  return { value, milliseconds };
}

function retryAt(clock: RemoteCommandClock, delayMs: number): string {
  return new Date(timestamp(clock).milliseconds + delayMs).toISOString();
}

function resolveConfiguration(options: RemoteCommandReconnectWorkerOptions) {
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const limit = options.limit ?? 1;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.destinationId) ||
    !/^sha256:[a-f0-9]{64}$/.test(options.expectedPeerIdentityHash) ||
    !/^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(options.nodeId) ||
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < 1_000 ||
    leaseDurationMs > 5 * 60_000 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 1_000 ||
    retryDelayMs > 60 * 60_000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 16
  ) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      "The remote command reconnect worker configuration is invalid.",
    );
  }
  return { leaseDurationMs, retryDelayMs, limit };
}

function parseLeases(input: {
  body: unknown;
  destinationId: string;
  nodeId: string;
  target: RemoteCommandTarget;
  limit: number;
  nowMs: number;
}): RemoteCommandLease[] {
  if (!Array.isArray(input.body) || input.body.length > input.limit) {
    throw new RemoteCommandDeliveryError("invalid_lease_response");
  }
  const leases = input.body as RemoteCommandLease[];
  for (const lease of leases) {
    try {
      assertRemoteCommandLease({ destinationId: input.destinationId, lease });
    } catch {
      throw new RemoteCommandDeliveryError("invalid_lease_response");
    }
    if (
      lease.leasedTo !== input.nodeId ||
      !sameTarget(lease.envelope.command.target, input.target) ||
      Date.parse(lease.leasedAt) > input.nowMs ||
      Date.parse(lease.leaseExpiresAt) <= input.nowMs
    ) {
      throw new RemoteCommandDeliveryError("invalid_lease_response");
    }
  }
  return structuredClone(leases);
}

async function sendAcknowledgement(input: {
  options: RemoteCommandReconnectWorkerOptions;
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
}): Promise<RemoteCommandDeliveryConfirmation> {
  let response: unknown;
  try {
    response = await input.options.transport.acknowledgeRemoteCommand(input.acknowledgement);
  } catch {
    throw new RemoteCommandDeliveryError("hub_unavailable");
  }
  const body = authenticatedRemoteCommandBody({
    response,
    destinationId: input.options.destinationId,
    expectedPeerIdentityHash: input.options.expectedPeerIdentityHash,
  }) as RemoteCommandDeliveryConfirmation;
  try {
    assertRemoteCommandDeliveryConfirmation({
      acknowledgement: input.acknowledgement,
      confirmation: body,
    });
  } catch {
    throw new RemoteCommandDeliveryError("invalid_delivery_confirmation");
  }
  return structuredClone(body);
}

export async function runRemoteCommandReconnectCycle(
  options: RemoteCommandReconnectWorkerOptions,
): Promise<RemoteCommandReconnectCycleResult> {
  const configuration = resolveConfiguration(options);
  const clock = options.clock ?? systemClock;
  const requested = timestamp(clock);
  let response: unknown;
  try {
    response = await options.transport.pullRemoteCommands({
      destinationId: options.destinationId,
      target: structuredClone(options.target),
      nodeId: options.nodeId,
      requestedAt: requested.value,
      leaseDurationMs: configuration.leaseDurationMs,
      limit: configuration.limit,
    });
  } catch {
    return {
      status: "offline",
      failureCode: "hub_unavailable",
      nextAttemptAt: retryAt(clock, configuration.retryDelayMs),
      leasedCount: 0,
      acknowledgedCount: 0,
    };
  }

  let leases: RemoteCommandLease[];
  try {
    const received = timestamp(clock);
    const body = authenticatedRemoteCommandBody({
      response,
      destinationId: options.destinationId,
      expectedPeerIdentityHash: options.expectedPeerIdentityHash,
    });
    leases = parseLeases({
      body,
      destinationId: options.destinationId,
      nodeId: options.nodeId,
      target: options.target,
      limit: configuration.limit,
      nowMs: received.milliseconds,
    });
  } catch (error) {
    if (!(error instanceof RemoteCommandDeliveryError)) throw error;
    return {
      status: "offline",
      failureCode: error.code,
      nextAttemptAt: retryAt(clock, configuration.retryDelayMs),
      leasedCount: 0,
      acknowledgedCount: 0,
    };
  }
  if (leases.length === 0) {
    return { status: "idle", leasedCount: 0, acknowledgedCount: 0 };
  }

  let acknowledgedCount = 0;
  let executedCount = 0;
  let failedCount = 0;
  let duplicateCount = 0;
  let rejectedCount = 0;
  for (const lease of leases) {
    let acknowledgement: RemoteCommandDeliveryAcknowledgement;
    try {
      const handled = await options.handler.handle(lease.envelope);
      acknowledgement = createCompletedRemoteCommandAcknowledgement({
        destinationId: options.destinationId,
        lease,
        receipt: handled.receipt,
        acknowledgedAt: timestamp(clock).value,
      });
      if (handled.deliveryStatus === "duplicate") duplicateCount += 1;
      else if (handled.receipt.outcome === "executed") executedCount += 1;
      else failedCount += 1;
    } catch (error) {
      if (!(error instanceof RemoteCommandRuntimeError) || !TERMINAL_REJECTIONS.has(error.code)) {
        const code =
          error instanceof RemoteCommandRuntimeError ? error.code : "replay_store_failed";
        return {
          status: "local_deferred",
          failureCode: code,
          nextAttemptAt: lease.leaseExpiresAt,
          leasedCount: leases.length,
          acknowledgedCount,
        };
      }
      acknowledgement = createRejectedRemoteCommandAcknowledgement({
        destinationId: options.destinationId,
        lease,
        rejectionCode: error.code as RejectionCode,
        acknowledgedAt: timestamp(clock).value,
      });
      rejectedCount += 1;
    }

    try {
      await sendAcknowledgement({ options, acknowledgement });
      acknowledgedCount += 1;
    } catch (error) {
      if (!(error instanceof RemoteCommandDeliveryError)) throw error;
      return {
        status: "acknowledgement_pending",
        failureCode: error.code,
        nextAttemptAt: lease.leaseExpiresAt,
        leasedCount: leases.length,
        acknowledgedCount,
      };
    }
  }
  return {
    status: "processed",
    leasedCount: leases.length,
    acknowledgedCount,
    executedCount,
    failedCount,
    duplicateCount,
    rejectedCount,
  };
}
