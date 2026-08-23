import { createHash, generateKeyPairSync } from "node:crypto";

import { createRemoteCommand } from "@lervo/remote-command-contract";
import { type RemoteCommand, type RemoteCommandTarget } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  ConfiguredEd25519RemoteCommandTrustStore,
  Ed25519RemoteCommandSigner,
  InMemoryRemoteCommandReplayStore,
  RemoteCommandReceiver,
  type RemoteCommandPolicyDecision,
  type RemoteCommandTrustStore,
} from "../src/index.js";

const target: RemoteCommandTarget = {
  projectId: "prj_remote_fixture",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const otherTarget: RemoteCommandTarget = {
  projectId: "prj_remote_other",
  projectIdentityHash: `sha256:${"b".repeat(64)}`,
};
const requestText = "Verify the task and summarize the result.";
const requestBytes = new TextEncoder().encode(requestText);
const requestReference = {
  artifactId: "art_remote_request",
  contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
  byteCount: requestBytes.byteLength,
  mediaType: "text/plain; charset=utf-8" as const,
};

interface CommandChanges {
  idempotencyKey?: string;
  nonceByte?: number;
  issuedAt?: string;
  expiresAt?: string;
  target?: RemoteCommandTarget;
}

function makeCommand(changes: CommandChanges = {}): RemoteCommand {
  return createRemoteCommand({
    idempotencyKey: changes.idempotencyKey ?? "idk_remote_command_01",
    nonce: Buffer.alloc(32, changes.nonceByte ?? 1).toString("base64url"),
    issuedAt: changes.issuedAt ?? "2026-08-19T00:00:00.000Z",
    expiresAt: changes.expiresAt ?? "2026-08-19T00:05:00.000Z",
    target: changes.target ?? target,
    action: {
      kind: "managed_run",
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      request: requestReference,
    },
  });
}

function setup(options: {
  command?: RemoteCommand;
  signerProjects?: RemoteCommandTarget[];
  receiverTarget?: RemoteCommandTarget;
  now?: () => string;
  policy?: () => Promise<RemoteCommandPolicyDecision>;
  payload?: () => Promise<Uint8Array>;
  execute?: (request: string) => Promise<{ runId: string; completedAt: string }>;
  replayStore?: InMemoryRemoteCommandReplayStore;
  trustStore?: RemoteCommandTrustStore;
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = new Ed25519RemoteCommandSigner("key_hub_fixture", privateKey);
  const command = options.command ?? makeCommand();
  const calls: string[] = [];
  const policy = vi.fn(async () => {
    calls.push("policy");
    return options.policy?.() ?? { status: "approved" as const };
  });
  const payloadLoader = vi.fn(async () => {
    calls.push("payload");
    return options.payload?.() ?? requestBytes;
  });
  const executor = vi.fn(async (input: { request: string }) => {
    calls.push("execute");
    return options.execute?.(input.request) ?? {
      runId: "run_remote_fixture",
      completedAt: "2026-08-19T00:01:00.000Z",
    };
  });
  const replayStore = options.replayStore ?? new InMemoryRemoteCommandReplayStore();
  const receiver = new RemoteCommandReceiver({
    target: options.receiverTarget ?? target,
    trustStore: options.trustStore ?? new ConfiguredEd25519RemoteCommandTrustStore([{
      keyId: signer.keyId,
      publicKey,
      projects: options.signerProjects ?? [target],
    }]),
    replayStore,
    policy: { authorize: policy },
    payloadLoader: { load: payloadLoader },
    executor: { execute: (input) => executor({ request: input.request }) },
    clock: { now: options.now ?? (() => "2026-08-19T00:01:00.000Z") },
  });
  return { calls, command, envelope: signer.sign(command), executor, payloadLoader, policy, receiver };
}

describe("signed remote command local receiver", () => {
  it("executes only after local policy and payload integrity checks", async () => {
    const fixture = setup();
    const result = await fixture.receiver.handle(fixture.envelope);

    expect(fixture.calls).toEqual(["policy", "payload", "execute"]);
    expect(result).toMatchObject({
      deliveryStatus: "processed",
      receipt: { outcome: "executed", runId: "run_remote_fixture" },
    });
    expect(fixture.executor).toHaveBeenCalledWith({ request: requestText });
    expect(JSON.stringify(fixture.envelope)).not.toContain(requestText);
  });

  it("rejects an invalid signature before policy or execution", async () => {
    const fixture = setup();
    const signature = fixture.envelope.signature.value;
    const forged = {
      ...fixture.envelope,
      signature: {
        ...fixture.envelope.signature,
        value: `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`,
      },
    };

    await expect(fixture.receiver.handle(forged)).rejects.toMatchObject({
      code: "invalid_signature",
    });
    expect(fixture.calls).toEqual([]);
  });

  it("rejects an unknown signing key before policy or execution", async () => {
    const fixture = setup({ trustStore: { find: async () => null } });

    await expect(fixture.receiver.handle(fixture.envelope)).rejects.toMatchObject({
      code: "unknown_signer",
    });
    expect(fixture.calls).toEqual([]);
  });

  it("enforces signer scope, receiver identity, and freshness before policy", async () => {
    const scopeDenied = setup({ signerProjects: [otherTarget] });
    await expect(scopeDenied.receiver.handle(scopeDenied.envelope)).rejects.toMatchObject({
      code: "signer_scope_denied",
    });
    expect(scopeDenied.calls).toEqual([]);

    const targetMismatch = setup({ receiverTarget: otherTarget });
    await expect(targetMismatch.receiver.handle(targetMismatch.envelope)).rejects.toMatchObject({
      code: "target_mismatch",
    });
    expect(targetMismatch.calls).toEqual([]);

    const expired = setup({ now: () => "2026-08-19T00:06:00.001Z" });
    await expect(expired.receiver.handle(expired.envelope)).rejects.toMatchObject({
      code: "command_expired",
    });
    expect(expired.calls).toEqual([]);
  });

  it("does not reserve a policy-denied command, so a later approved retry can execute", async () => {
    let approved = false;
    const fixture = setup({
      policy: async () => approved
        ? { status: "approved" }
        : { status: "denied", reasonCode: "manual_confirmation_required" },
    });

    await expect(fixture.receiver.handle(fixture.envelope)).rejects.toMatchObject({
      code: "policy_denied",
    });
    expect(fixture.payloadLoader).not.toHaveBeenCalled();
    approved = true;
    const result = await fixture.receiver.handle(fixture.envelope);
    expect(result.receipt.outcome).toBe("executed");
    expect(fixture.executor).toHaveBeenCalledTimes(1);
  });

  it("stores payload and execution failures as terminal receipts without leaking details", async () => {
    const unavailable = setup({ payload: async () => { throw new Error("artifact secret"); } });
    const unavailableResult = await unavailable.receiver.handle(unavailable.envelope);
    expect(unavailableResult.receipt).toMatchObject({
      outcome: "failed",
      failureCode: "payload_unavailable",
    });
    expect(JSON.stringify(unavailableResult)).not.toContain("artifact secret");

    const payloadFailure = setup({ payload: async () => new Uint8Array([1, 2, 3]) });
    const first = await payloadFailure.receiver.handle(payloadFailure.envelope);
    const retry = await payloadFailure.receiver.handle(payloadFailure.envelope);
    expect(first.receipt).toMatchObject({ outcome: "failed", failureCode: "payload_mismatch" });
    expect(retry).toEqual({ deliveryStatus: "duplicate", receipt: first.receipt });
    expect(payloadFailure.payloadLoader).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain(requestText);

    const executionFailure = setup({ execute: async () => { throw new Error("secret detail"); } });
    const failed = await executionFailure.receiver.handle(executionFailure.envelope);
    const failedRetry = await executionFailure.receiver.handle(executionFailure.envelope);
    expect(failed.receipt).toMatchObject({ outcome: "failed", failureCode: "execution_failed" });
    expect(failedRetry.deliveryStatus).toBe("duplicate");
    expect(executionFailure.executor).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failed)).not.toContain("secret detail");
  });

  it("returns a completed duplicate after expiry without executing twice", async () => {
    let now = "2026-08-19T00:01:00.000Z";
    const fixture = setup({ now: () => now });
    const first = await fixture.receiver.handle(fixture.envelope);
    now = "2026-08-20T00:00:00.000Z";
    const retry = await fixture.receiver.handle(fixture.envelope);

    expect(retry).toEqual({ deliveryStatus: "duplicate", receipt: first.receipt });
    expect(fixture.executor).toHaveBeenCalledTimes(1);
  });

  it("rejects conflicting idempotency keys and replayed nonces", async () => {
    const replayStore = new InMemoryRemoteCommandReplayStore();
    const first = setup({ replayStore });
    await first.receiver.handle(first.envelope);

    const conflict = setup({
      command: makeCommand({ nonceByte: 2 }),
      replayStore,
    });
    await expect(conflict.receiver.handle(conflict.envelope)).rejects.toMatchObject({
      code: "idempotency_conflict",
    });

    const nonceReplay = setup({
      command: makeCommand({ idempotencyKey: "idk_remote_command_02" }),
      replayStore,
    });
    await expect(nonceReplay.receiver.handle(nonceReplay.envelope)).rejects.toMatchObject({
      code: "nonce_replay",
    });
    expect(conflict.executor).not.toHaveBeenCalled();
    expect(nonceReplay.executor).not.toHaveBeenCalled();
  });

  it("allows only one concurrent execution for the same command", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const executionStarted = new Promise<void>((resolve) => { started = resolve; });
    const fixture = setup({
      execute: async () => {
        started();
        await waiting;
        return {
          runId: "run_remote_fixture",
          completedAt: "2026-08-19T00:01:00.000Z",
        };
      },
    });

    const first = fixture.receiver.handle(fixture.envelope);
    await executionStarted;
    await expect(fixture.receiver.handle(fixture.envelope)).rejects.toMatchObject({
      code: "command_in_progress",
    });
    release();
    await expect(first).resolves.toMatchObject({ receipt: { outcome: "executed" } });
    expect(fixture.executor).toHaveBeenCalledTimes(1);
  });

  it("makes reservation atomic when two policy checks finish together", async () => {
    let releasePolicy!: () => void;
    const policyGate = new Promise<void>((resolve) => { releasePolicy = resolve; });
    let policyCount = 0;
    let bothPolicies!: () => void;
    const bothPoliciesStarted = new Promise<void>((resolve) => { bothPolicies = resolve; });
    const fixture = setup({
      policy: async () => {
        policyCount += 1;
        if (policyCount === 2) bothPolicies();
        await policyGate;
        return { status: "approved" };
      },
    });

    const first = fixture.receiver.handle(fixture.envelope);
    const second = fixture.receiver.handle(fixture.envelope);
    await bothPoliciesStarted;
    releasePolicy();
    const settled = await Promise.allSettled([first, second]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(
      (result) => result.status === "rejected" && result.reason?.code === "command_in_progress",
    )).toHaveLength(1);
    expect(fixture.executor).toHaveBeenCalledTimes(1);
  });
});
