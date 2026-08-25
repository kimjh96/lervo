import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandDeliveryConfirmation,
  type RemoteCommandExecutionReceipt,
  type RemoteCommandLease,
  type SignedRemoteCommand,
  validateSchema,
} from "@lervo/schemas";

import { RemoteCommandContractError } from "./errors.js";
import {
  assertRemoteCommandExecutionReceipt,
  assertSignedRemoteCommand,
  calculateRemoteCommandHash,
} from "./integrity.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function calculateRemoteCommandDeliveryId(input: {
  destinationId: string;
  envelope: SignedRemoteCommand;
}): string {
  if (!DESTINATION_PATTERN.test(input.destinationId)) {
    throw new RemoteCommandContractError(
      "invalid_delivery_lease",
      "The remote command destination ID is invalid.",
    );
  }
  assertSignedRemoteCommand(input.envelope);
  return `rcd_${sha256(
    canonicalJson({
      destinationId: input.destinationId,
      envelope: input.envelope,
    }),
  ).slice("sha256:".length)}`;
}

export function createRemoteCommandLease(input: {
  destinationId: string;
  leaseId: string;
  leasedTo: string;
  leasedAt: string;
  leaseExpiresAt: string;
  envelope: SignedRemoteCommand;
}): RemoteCommandLease {
  const lease: RemoteCommandLease = {
    schemaVersion: 1,
    deliveryId: calculateRemoteCommandDeliveryId(input),
    leaseId: input.leaseId,
    leasedTo: input.leasedTo,
    leasedAt: input.leasedAt,
    leaseExpiresAt: input.leaseExpiresAt,
    envelope: clone(input.envelope),
  };
  assertRemoteCommandLease({ destinationId: input.destinationId, lease });
  return clone(lease);
}

export function assertRemoteCommandLease(input: {
  destinationId: string;
  lease: RemoteCommandLease;
}): void {
  if (!validateSchema("remoteCommandLease", input.lease).valid) {
    throw new RemoteCommandContractError(
      "invalid_delivery_lease",
      "The remote command delivery lease is invalid.",
    );
  }
  assertSignedRemoteCommand(input.lease.envelope);
  if (
    input.lease.deliveryId !==
      calculateRemoteCommandDeliveryId({
        destinationId: input.destinationId,
        envelope: input.lease.envelope,
      }) ||
    Date.parse(input.lease.leaseExpiresAt) <= Date.parse(input.lease.leasedAt)
  ) {
    throw new RemoteCommandContractError(
      "invalid_delivery_lease",
      "The remote command delivery lease coordinates or interval differ from the source.",
    );
  }
}

function acknowledgementBase(lease: RemoteCommandLease, acknowledgedAt: string) {
  return {
    schemaVersion: 1 as const,
    deliveryId: lease.deliveryId,
    leaseId: lease.leaseId,
    commandId: lease.envelope.command.commandId,
    commandHash: calculateRemoteCommandHash(lease.envelope.command),
    acknowledgedAt,
  };
}

export function createCompletedRemoteCommandAcknowledgement(input: {
  destinationId: string;
  lease: RemoteCommandLease;
  receipt: RemoteCommandExecutionReceipt;
  acknowledgedAt: string;
}): RemoteCommandDeliveryAcknowledgement {
  assertRemoteCommandLease(input);
  assertRemoteCommandExecutionReceipt({
    command: input.lease.envelope.command,
    receipt: input.receipt,
  });
  const acknowledgement: RemoteCommandDeliveryAcknowledgement = {
    ...acknowledgementBase(input.lease, input.acknowledgedAt),
    disposition: "completed",
    receipt: clone(input.receipt),
  };
  assertRemoteCommandDeliveryAcknowledgement({ lease: input.lease, acknowledgement });
  return clone(acknowledgement);
}

export function createRejectedRemoteCommandAcknowledgement(input: {
  destinationId: string;
  lease: RemoteCommandLease;
  rejectionCode: Extract<
    RemoteCommandDeliveryAcknowledgement,
    { disposition: "rejected" }
  >["rejectionCode"];
  acknowledgedAt: string;
}): RemoteCommandDeliveryAcknowledgement {
  assertRemoteCommandLease(input);
  const acknowledgement: RemoteCommandDeliveryAcknowledgement = {
    ...acknowledgementBase(input.lease, input.acknowledgedAt),
    disposition: "rejected",
    rejectionCode: input.rejectionCode,
  };
  assertRemoteCommandDeliveryAcknowledgement({ lease: input.lease, acknowledgement });
  return clone(acknowledgement);
}

export function assertRemoteCommandDeliveryAcknowledgement(input: {
  lease: RemoteCommandLease;
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
}): void {
  if (!validateSchema("remoteCommandDeliveryAcknowledgement", input.acknowledgement).valid) {
    throw new RemoteCommandContractError(
      "invalid_delivery_acknowledgement",
      "The remote command delivery acknowledgement is invalid.",
    );
  }
  const command = input.lease.envelope.command;
  if (
    input.acknowledgement.deliveryId !== input.lease.deliveryId ||
    input.acknowledgement.leaseId !== input.lease.leaseId ||
    input.acknowledgement.commandId !== command.commandId ||
    input.acknowledgement.commandHash !== calculateRemoteCommandHash(command)
  ) {
    throw new RemoteCommandContractError(
      "invalid_delivery_acknowledgement",
      "The remote command acknowledgement coordinates differ from the lease.",
    );
  }
  const acknowledgedAt = Date.parse(input.acknowledgement.acknowledgedAt);
  if (
    acknowledgedAt < Date.parse(input.lease.leasedAt) ||
    acknowledgedAt > Date.parse(input.lease.leaseExpiresAt)
  ) {
    throw new RemoteCommandContractError(
      "invalid_delivery_acknowledgement",
      "The remote command acknowledgement time falls outside the lease interval.",
    );
  }
  if (input.acknowledgement.disposition === "completed") {
    assertRemoteCommandExecutionReceipt({
      command,
      receipt: input.acknowledgement.receipt,
    });
  }
}

export function calculateRemoteCommandAcknowledgementHash(
  acknowledgement: RemoteCommandDeliveryAcknowledgement,
): string {
  if (!validateSchema("remoteCommandDeliveryAcknowledgement", acknowledgement).valid) {
    throw new RemoteCommandContractError(
      "invalid_delivery_acknowledgement",
      "The remote command acknowledgement hash input is invalid.",
    );
  }
  return sha256(canonicalJson(acknowledgement));
}

export function createRemoteCommandDeliveryConfirmation(input: {
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
  status: "accepted" | "duplicate";
  confirmedAt: string;
}): RemoteCommandDeliveryConfirmation {
  const confirmation: RemoteCommandDeliveryConfirmation = {
    schemaVersion: 1,
    deliveryId: input.acknowledgement.deliveryId,
    commandId: input.acknowledgement.commandId,
    acknowledgementHash: calculateRemoteCommandAcknowledgementHash(input.acknowledgement),
    status: input.status,
    disposition: input.acknowledgement.disposition,
    confirmedAt: input.confirmedAt,
  };
  assertRemoteCommandDeliveryConfirmation({
    acknowledgement: input.acknowledgement,
    confirmation,
  });
  return clone(confirmation);
}

export function assertRemoteCommandDeliveryConfirmation(input: {
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
  confirmation: RemoteCommandDeliveryConfirmation;
}): void {
  if (
    !validateSchema("remoteCommandDeliveryConfirmation", input.confirmation).valid ||
    input.confirmation.deliveryId !== input.acknowledgement.deliveryId ||
    input.confirmation.commandId !== input.acknowledgement.commandId ||
    input.confirmation.acknowledgementHash !==
      calculateRemoteCommandAcknowledgementHash(input.acknowledgement) ||
    input.confirmation.disposition !== input.acknowledgement.disposition ||
    Date.parse(input.confirmation.confirmedAt) < Date.parse(input.acknowledgement.acknowledgedAt)
  ) {
    throw new RemoteCommandContractError(
      "invalid_delivery_confirmation",
      "The remote command delivery confirmation differs from the acknowledgement.",
    );
  }
}
