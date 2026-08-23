import {
  assertSignedRemoteCommand,
  calculateRemoteCommandDeliveryId,
} from "@lervo/remote-command-contract";
import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
  validateSchema,
} from "@lervo/schemas";

import { type HubRemoteCommandQueueStore } from "./remote-command-store.js";
import { HubRemoteCommandRequestError } from "./remote-command-errors.js";
import { type HubRemoteCommandRequestErrorCode } from "./remote-command-errors.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NODE_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const TARGET_ID_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function timestamp(
  value: string,
  label: string,
  code: HubRemoteCommandRequestErrorCode,
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new HubRemoteCommandRequestError(
      code,
      `${label} is invalid.`,
    );
  }
  return parsed;
}

function assertDestination(
  destinationId: string,
  code: HubRemoteCommandRequestErrorCode,
): void {
  if (!DESTINATION_PATTERN.test(destinationId)) {
    throw new HubRemoteCommandRequestError(
      code,
      "The remote command destination ID is invalid.",
    );
  }
}

function assertTarget(target: RemoteCommandTarget): void {
  if (
    !TARGET_ID_PATTERN.test(target.projectId) ||
    !HASH_PATTERN.test(target.projectIdentityHash)
  ) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_lease_request",
      "The remote command lease target is invalid.",
    );
  }
}

export async function handleRemoteCommandEnqueue(input: {
  store: HubRemoteCommandQueueStore;
  destinationId: string;
  envelope: SignedRemoteCommand;
  queuedAt: string;
}) {
  assertDestination(input.destinationId, "invalid_remote_command_enqueue");
  assertSignedRemoteCommand(input.envelope);
  calculateRemoteCommandDeliveryId({
    destinationId: input.destinationId,
    envelope: input.envelope,
  });
  if (timestamp(input.queuedAt, "remote command queuedAt", "invalid_remote_command_enqueue") >=
    timestamp(
      input.envelope.command.expiresAt,
      "remote command expiresAt",
      "invalid_remote_command_enqueue",
    )) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_enqueue",
      "An expired remote command cannot be queued.",
    );
  }
  return input.store.enqueueRemoteCommand({
    destinationId: input.destinationId,
    envelope: structuredClone(input.envelope),
    queuedAt: input.queuedAt,
  });
}

export async function handleRemoteCommandLease(input: {
  store: HubRemoteCommandQueueStore;
  destinationId: string;
  target: RemoteCommandTarget;
  leasedTo: string;
  leasedAt: string;
  leaseDurationMs: number;
  limit?: number;
}) {
  assertDestination(input.destinationId, "invalid_remote_command_lease_request");
  assertTarget(input.target);
  timestamp(input.leasedAt, "remote command leasedAt", "invalid_remote_command_lease_request");
  if (!NODE_PATTERN.test(input.leasedTo)) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_lease_request",
      "The remote command leasedTo value is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < 1_000 ||
    input.leaseDurationMs > 5 * 60_000
  ) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_lease_request",
      "The remote command lease duration must be between 1 second and 5 minutes.",
    );
  }
  const limit = input.limit ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_lease_request",
      "The remote command lease limit must be between 1 and 16.",
    );
  }
  return input.store.leaseRemoteCommands({
    destinationId: input.destinationId,
    target: structuredClone(input.target),
    leasedTo: input.leasedTo,
    leasedAt: input.leasedAt,
    leaseDurationMs: input.leaseDurationMs,
    limit,
  });
}

export async function handleRemoteCommandAcknowledgement(input: {
  store: HubRemoteCommandQueueStore;
  destinationId: string;
  target: RemoteCommandTarget;
  leasedTo: string;
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
  confirmedAt: string;
}) {
  assertDestination(input.destinationId, "invalid_remote_command_acknowledgement");
  assertTarget(input.target);
  if (!NODE_PATTERN.test(input.leasedTo)) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_acknowledgement",
      "The remote command acknowledgement node is invalid.",
    );
  }
  timestamp(
    input.confirmedAt,
    "remote command confirmedAt",
    "invalid_remote_command_acknowledgement",
  );
  if (!validateSchema("remoteCommandDeliveryAcknowledgement", input.acknowledgement).valid) {
    throw new HubRemoteCommandRequestError(
      "invalid_remote_command_acknowledgement",
      "The remote command acknowledgement schema is invalid.",
    );
  }
  return input.store.acknowledgeRemoteCommand({
    destinationId: input.destinationId,
    target: structuredClone(input.target),
    leasedTo: input.leasedTo,
    acknowledgement: structuredClone(input.acknowledgement),
    confirmedAt: input.confirmedAt,
  });
}
