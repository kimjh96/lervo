import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  assertRemoteCommand,
  assertRemoteCommandExecutionReceipt,
  assertRemoteCommandDeliveryConfirmation,
  calculateRemoteCommandHash,
  calculateRemoteCommandDeliveryId,
  createCompletedRemoteCommandAcknowledgement,
  createRemoteCommand,
  createRemoteCommandDeliveryConfirmation,
  createRemoteCommandLease,
  createSignedRemoteCommandEnvelope,
  remoteCommandSigningBytes,
} from "../src/index.js";

const target = {
  projectId: "prj_remote_fixture",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
} as const;
const request = new TextEncoder().encode("Verify the task and summarize the result.");
const requestReference = {
  artifactId: "art_remote_request",
  contentHash: `sha256:${createHash("sha256").update(request).digest("hex")}`,
  byteCount: request.byteLength,
  mediaType: "text/plain; charset=utf-8",
} as const;

function commandInput() {
  return {
    idempotencyKey: "idk_remote_command_01",
    nonce: Buffer.alloc(32, 1).toString("base64url"),
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T00:05:00.000Z",
    target,
    action: {
      kind: "managed_run" as const,
      roleId: "developer",
      provider: "codex",
      risk: "medium" as const,
      verificationSuiteIds: ["repo.check"],
      request: requestReference,
    },
  };
}

describe("remote command contract", () => {
  it("derives a stable identity from canonical command content without embedding the request", () => {
    const first = createRemoteCommand(commandInput());
    const second = createRemoteCommand(commandInput());

    expect(second).toEqual(first);
    expect(first.commandId).toMatch(/^rcm_[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("Verify the task");

    const changed = createRemoteCommand({
      ...commandInput(),
      action: {
        ...commandInput().action,
        request: { ...requestReference, artifactId: "art_remote_changed" },
      },
    });
    expect(changed.commandId).not.toBe(first.commandId);
  });

  it("binds an Ed25519 signature to the key id and canonical command", () => {
    const command = createRemoteCommand(commandInput());
    const { privateKey } = generateKeyPairSync("ed25519");
    const signature = sign(null, remoteCommandSigningBytes({
      command,
      keyId: "key_hub_fixture",
    }), privateKey);
    const envelope = createSignedRemoteCommandEnvelope({
      command,
      keyId: "key_hub_fixture",
      signature,
    });

    expect(envelope.signature).toMatchObject({ algorithm: "ed25519" });
    expect(envelope.signature.value).toHaveLength(86);
    expect(remoteCommandSigningBytes({ command, keyId: "key_hub_fixture" }))
      .not.toEqual(remoteCommandSigningBytes({ command, keyId: "key_other_fixture" }));
  });

  it("rejects a forged command id and a receipt for a different command", () => {
    const command = createRemoteCommand(commandInput());
    expect(() => assertRemoteCommand({
      ...command,
      commandId: `rcm_${"0".repeat(64)}`,
    })).toThrowError(expect.objectContaining({ code: "invalid_command" }));

    expect(() => assertRemoteCommandExecutionReceipt({
      command,
      receipt: {
        schemaVersion: 1,
        commandId: command.commandId,
        commandHash: `sha256:${"0".repeat(64)}`,
        idempotencyKey: command.idempotencyKey,
        processedAt: "2026-08-19T00:01:00.000Z",
        outcome: "executed",
        runId: "run_remote_fixture",
      },
    })).toThrowError(expect.objectContaining({ code: "invalid_execution_receipt" }));

    expect(calculateRemoteCommandHash(command)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("binds a durable lease, acknowledgement, and confirmation to one delivery", () => {
    const command = createRemoteCommand(commandInput());
    const { privateKey } = generateKeyPairSync("ed25519");
    const signature = sign(null, remoteCommandSigningBytes({
      command,
      keyId: "key_hub_fixture",
    }), privateKey);
    const envelope = createSignedRemoteCommandEnvelope({
      command,
      keyId: "key_hub_fixture",
      signature,
    });
    const destinationId = "hub:primary";
    const lease = createRemoteCommandLease({
      destinationId,
      leaseId: `rcl_${Buffer.alloc(32, 4).toString("base64url")}`,
      leasedTo: "node_remote_fixture",
      leasedAt: "2026-08-19T00:01:00.000Z",
      leaseExpiresAt: "2026-08-19T00:01:30.000Z",
      envelope,
    });
    const acknowledgement = createCompletedRemoteCommandAcknowledgement({
      destinationId,
      lease,
      acknowledgedAt: "2026-08-19T00:01:10.000Z",
      receipt: {
        schemaVersion: 1,
        commandId: command.commandId,
        commandHash: calculateRemoteCommandHash(command),
        idempotencyKey: command.idempotencyKey,
        processedAt: "2026-08-19T00:01:05.000Z",
        outcome: "executed",
        runId: "run_remote_fixture",
      },
    });
    const confirmation = createRemoteCommandDeliveryConfirmation({
      acknowledgement,
      status: "accepted",
      confirmedAt: "2026-08-19T00:01:11.000Z",
    });

    expect(lease.deliveryId).toBe(calculateRemoteCommandDeliveryId({
      destinationId,
      envelope,
    }));
    expect(confirmation).toMatchObject({
      deliveryId: lease.deliveryId,
      commandId: command.commandId,
      disposition: "completed",
      status: "accepted",
    });
    expect(() => assertRemoteCommandDeliveryConfirmation({
      acknowledgement,
      confirmation: { ...confirmation, commandId: `rcm_${"0".repeat(64)}` },
    })).toThrowError(expect.objectContaining({ code: "invalid_delivery_confirmation" }));
    if (acknowledgement.disposition !== "completed") throw new Error("unreachable fixture");
    expect(() => createCompletedRemoteCommandAcknowledgement({
      destinationId,
      lease,
      acknowledgedAt: "2026-08-19T00:01:31.000Z",
      receipt: acknowledgement.receipt,
    })).toThrowError(expect.objectContaining({ code: "invalid_delivery_acknowledgement" }));
  });
});
