import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ConfiguredEd25519PolicyTrustStore,
  Ed25519PolicySigner,
  PolicyBackedRemoteCommandPolicy,
  PolicyManagedRunApprovalVerifier,
  runPolicySyncCycle,
  type AuthenticatedPolicyHubTransport,
  type PolicyBundle,
} from "@lervo/policy";
import {
  createPolicyApproval,
  createPolicyApprovalRevocation,
  createPolicySnapshot,
} from "@lervo/policy-contract";
import {
  ConfiguredEd25519RemoteCommandTrustStore,
  Ed25519RemoteCommandSigner,
  InMemoryRemoteCommandReplayStore,
  RemoteCommandReceiver,
} from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import {
  type CapabilityDecision,
  type ManagedRunApprovalAuthorization,
  type RemoteCommand,
} from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQLitePolicyStateStore } from "../src/index.js";

const roots: string[] = [];
const target = {
  projectId: "prj_policy_approval",
  projectIdentityHash: `sha256:${"a".repeat(64)}`,
};
const destinationId = "hub.policy.fixture";
const peerIdentityHash = `sha256:${"d".repeat(64)}`;
const requestText = "Execute exactly once after approval.";
const requestBytes = new TextEncoder().encode(requestText);

class MutableClock {
  constructor(public value: string) {}
  now(): string { return this.value; }
}

class FixturePolicyTransport implements AuthenticatedPolicyHubTransport {
  bundle: PolicyBundle | null = null;
  offline = false;
  peerHash = peerIdentityHash;

  async pullPolicyBundle(): Promise<unknown> {
    if (this.offline) throw new Error("fixture offline");
    return {
      authentication: {
        status: "verified",
        destinationId,
        peerIdentityHash: this.peerHash,
      },
      body: structuredClone(this.bundle),
    };
  }
}

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-policy-"));
  roots.push(root);
  return join(root, "policy.sqlite");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function command(nonceByte = 1, idempotencyKey = "idk_policy_approval_01"): RemoteCommand {
  return createRemoteCommand({
    idempotencyKey,
    nonce: Buffer.alloc(32, nonceByte).toString("base64url"),
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T00:10:00.000Z",
    target,
    action: {
      kind: "managed_run",
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      request: {
        artifactId: "art_policy_approval_request",
        contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
        byteCount: requestBytes.byteLength,
        mediaType: "text/plain; charset=utf-8",
      },
    },
  });
}

function snapshot(input: { sequence?: number; previousSnapshotId?: string | null; decision?: CapabilityDecision } = {}) {
  return createPolicySnapshot({
    target,
    sequence: input.sequence ?? 1,
    previousSnapshotId: input.previousSnapshotId ?? null,
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: "2026-08-19T01:00:00.000Z",
    rules: [{
      ruleId: `polr_developer_write_${input.sequence ?? 1}`,
      roleId: "developer",
      risk: "medium",
      capability: "filesystem.write",
      repositoryPaths: ["src/result.ts"],
      decision: input.decision ?? "require_approval",
    }],
  });
}

function remoteReceiver(input: {
  command: RemoteCommand;
  policy: PolicyBackedRemoteCommandPolicy;
  clock: MutableClock;
  remotePrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  remotePublicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
  execute: ReturnType<typeof vi.fn>;
}) {
  const signer = new Ed25519RemoteCommandSigner("key_remote_policy", input.remotePrivateKey);
  return {
    envelope: signer.sign(input.command),
    receiver: new RemoteCommandReceiver({
      target,
      trustStore: new ConfiguredEd25519RemoteCommandTrustStore([{
        keyId: signer.keyId,
        publicKey: input.remotePublicKey,
        projects: [target],
      }]),
      replayStore: new InMemoryRemoteCommandReplayStore(),
      policy: input.policy,
      payloadLoader: { load: async () => requestBytes },
      executor: {
        execute: async (execution) => {
          input.execute(execution);
          return { runId: "run_policy_approved", completedAt: input.clock.value };
        },
      },
      clock: input.clock,
      maxLifetimeMs: 15 * 60_000,
    }),
  };
}

function trustStore(input: {
  publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
  purposes?: Array<"snapshot" | "approval" | "revocation">;
}) {
  return new ConfiguredEd25519PolicyTrustStore([{
    keyId: "key_policy_fixture",
    publicKey: input.publicKey,
    projects: [target],
    purposes: input.purposes ?? ["snapshot", "approval", "revocation"],
  }]);
}

async function sync(input: {
  store: SQLitePolicyStateStore;
  transport: FixturePolicyTransport;
  publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
  clock: MutableClock;
  purposes?: Array<"snapshot" | "approval" | "revocation">;
}) {
  return runPolicySyncCycle({
    destinationId,
    expectedPeerIdentityHash: peerIdentityHash,
    target,
    transport: input.transport,
    trustStore: trustStore({
      publicKey: input.publicKey,
      ...(input.purposes === undefined ? {} : { purposes: input.purposes }),
    }),
    store: input.store,
    clock: input.clock,
  });
}

describe("durable Hub policy and approval lifecycle", () => {
  it("defers a command, survives restart, then executes it once with command-bound approval evidence", async () => {
    const policyKeys = generateKeyPairSync("ed25519");
    const remoteKeys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_policy_fixture", policyKeys.privateKey);
    const policySnapshot = snapshot();
    const signedSnapshot = signer.signSnapshot(policySnapshot);
    const remoteCommand = command();
    const transport = new FixturePolicyTransport();
    transport.bundle = { snapshot: signedSnapshot, approvals: [], revocations: [] };
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    const path = await databasePath();
    let store = await SQLitePolicyStateStore.open({ path, target });

    await expect(sync({ store, transport, publicKey: policyKeys.publicKey, clock })).resolves.toMatchObject({
      status: "applied",
      approvalCount: 0,
    });
    const localPolicy = {
      resolve: async () => [{ capability: "filesystem.write" as const, decision: "allow" as const }],
    };
    const configuredTrustStore = trustStore({ publicKey: policyKeys.publicKey });
    let policy = new PolicyBackedRemoteCommandPolicy({
      store,
      trustStore: configuredTrustStore,
      localPolicy,
    });
    const execute = vi.fn();
    let fixture = remoteReceiver({
      command: remoteCommand,
      policy,
      clock,
      remotePrivateKey: remoteKeys.privateKey,
      remotePublicKey: remoteKeys.publicKey,
      execute,
    });
    await expect(fixture.receiver.handle(fixture.envelope)).rejects.toMatchObject({ code: "approval_required" });
    expect(execute).not.toHaveBeenCalled();

    const approverIdentity = "alice@example.invalid";
    const approval = createPolicyApproval({
      snapshot: policySnapshot,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_policy",
      capability: "filesystem.write",
      repositoryPaths: ["src/result.ts"],
      approverSubjectHash: `sha256:${createHash("sha256").update(approverIdentity).digest("hex")}`,
      grantedAt: "2026-08-19T00:02:00.000Z",
      expiresAt: "2026-08-19T00:09:00.000Z",
    });
    transport.bundle = {
      snapshot: signedSnapshot,
      approvals: [signer.signApproval(approval)],
      revocations: [],
    };
    clock.value = "2026-08-19T00:02:00.000Z";
    await expect(sync({ store, transport, publicKey: policyKeys.publicKey, clock })).resolves.toMatchObject({
      status: "applied",
      approvalCount: 1,
    });
    await expect(policy.authorize({
      command: remoteCommand,
      signerKeyId: "key_remote_other",
      evaluatedAt: clock.value,
    })).resolves.toMatchObject({ status: "approval_required" });
    store.close();

    store = await SQLitePolicyStateStore.open({ path, target });
    policy = new PolicyBackedRemoteCommandPolicy({
      store,
      trustStore: configuredTrustStore,
      localPolicy,
    });
    fixture = remoteReceiver({
      command: remoteCommand,
      policy,
      clock,
      remotePrivateKey: remoteKeys.privateKey,
      remotePublicKey: remoteKeys.publicKey,
      execute,
    });
    clock.value = "2026-08-19T00:03:00.000Z";
    const first = await fixture.receiver.handle(fixture.envelope);
    const duplicate = await fixture.receiver.handle(fixture.envelope);
    expect(first.receipt).toMatchObject({ outcome: "executed" });
    expect(duplicate.deliveryStatus).toBe("duplicate");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      approvedRepositoryPaths: ["src/result.ts"],
      policyAuthorization: {
        source: "remote_command",
        commandSignerKeyId: "key_remote_policy",
        policySnapshotId: policySnapshot.snapshotId,
        approvalIds: [approval.approvalId],
      },
    });

    const authorization = execute.mock.calls[0]?.[0]
      .policyAuthorization as ManagedRunApprovalAuthorization | null;
    if (authorization === null) throw new Error("expected managed run approval evidence");
    const verifier = new PolicyManagedRunApprovalVerifier({
      store,
      trustStore: configuredTrustStore,
    });
    const verificationInput = {
      authorization,
      projectId: target.projectId,
      runId: "run_policy_approved",
      sessionId: "ses_policy_approved",
      roleId: remoteCommand.action.roleId,
      provider: remoteCommand.action.provider,
      risk: remoteCommand.action.risk,
      requestDigest: remoteCommand.action.request.contentHash,
      verificationSuiteIds: [...remoteCommand.action.verificationSuiteIds],
      expectedPaths: ["src/result.ts"],
      requestedPath: "src/result.ts",
      evaluatedAt: clock.value,
    };
    await expect(verifier.verify(verificationInput)).resolves.toEqual({
      approved: true,
      approvalId: approval.approvalId,
      policySnapshotId: policySnapshot.snapshotId,
    });
    await expect(verifier.verify({
      ...verificationInput,
      expectedPaths: ["src/unapproved.ts"],
      requestedPath: "src/unapproved.ts",
    })).resolves.toEqual({
      approved: false,
      reasonCode: "active_approval_missing",
    });

    const revocation = createPolicyApprovalRevocation({
      approval,
      revokedAt: "2026-08-19T00:04:00.000Z",
      reasonCode: "cancelled",
    });
    transport.bundle = {
      snapshot: signedSnapshot,
      approvals: [signer.signApproval(approval)],
      revocations: [signer.signRevocation(revocation)],
    };
    clock.value = "2026-08-19T00:04:00.000Z";
    await sync({ store, transport, publicKey: policyKeys.publicKey, clock });
    await expect(verifier.verify({
      ...verificationInput,
      evaluatedAt: clock.value,
    })).resolves.toEqual({
      approved: false,
      reasonCode: "active_approval_missing",
    });
    await expect(verifier.verify({
      ...verificationInput,
      evaluatedAt: "2026-08-19T00:10:00.001Z",
    })).resolves.toEqual({
      approved: false,
      reasonCode: "remote_command_not_current",
    });
    store.close();

    const database = new DatabaseSync(path);
    const originals = JSON.stringify({
      approvals: database.prepare("SELECT envelope_json FROM policy_approvals").all(),
      snapshots: database.prepare("SELECT envelope_json FROM policy_snapshots").all(),
    });
    expect(originals).not.toContain(requestText);
    expect(originals).not.toContain(approverIdentity);
    database.close();
  });

  it("honors revocation and expiry, and never lets Hub policy relax a local deny", async () => {
    const policyKeys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_policy_fixture", policyKeys.privateKey);
    const policySnapshot = snapshot();
    const remoteCommand = command(2, "idk_policy_approval_02");
    const approval = createPolicyApproval({
      repositoryPaths: ["src/result.ts"],
      snapshot: policySnapshot,
      command: remoteCommand,
      commandSignerKeyId: "key_remote_policy",
      capability: "filesystem.write",
      approverSubjectHash: `sha256:${"b".repeat(64)}`,
      grantedAt: "2026-08-19T00:01:00.000Z",
      expiresAt: "2026-08-19T00:05:00.000Z",
    });
    const revocation = createPolicyApprovalRevocation({
      approval,
      revokedAt: "2026-08-19T00:02:00.000Z",
      reasonCode: "cancelled",
    });
    const transport = new FixturePolicyTransport();
    transport.bundle = {
      snapshot: signer.signSnapshot(policySnapshot),
      approvals: [signer.signApproval(approval)],
      revocations: [signer.signRevocation(revocation)],
    };
    const clock = new MutableClock("2026-08-19T00:03:00.000Z");
    const store = await SQLitePolicyStateStore.open({ path: await databasePath(), target });
    await sync({ store, transport, publicKey: policyKeys.publicKey, clock });

    const requirePolicy = new PolicyBackedRemoteCommandPolicy({
      store,
      trustStore: trustStore({ publicKey: policyKeys.publicKey }),
      localPolicy: { resolve: async () => [{ capability: "filesystem.write", decision: "allow" }] },
    });
    await expect(requirePolicy.authorize({ command: remoteCommand, signerKeyId: "key_remote_policy", evaluatedAt: clock.value })).resolves.toMatchObject({
      status: "approval_required",
    });
    const denyPolicy = new PolicyBackedRemoteCommandPolicy({
      store,
      trustStore: trustStore({ publicKey: policyKeys.publicKey }),
      localPolicy: { resolve: async () => [{ capability: "filesystem.write", decision: "deny" }] },
    });
    await expect(denyPolicy.authorize({ command: remoteCommand, signerKeyId: "key_remote_policy", evaluatedAt: "2026-08-19T00:01:30.000Z" })).resolves.toEqual({
      status: "denied",
      reasonCode: "local_policy_denied",
    });
    await expect(requirePolicy.authorize({ command: remoteCommand, signerKeyId: "key_remote_policy", evaluatedAt: "2026-08-19T00:05:00.001Z" })).resolves.toMatchObject({
      status: "approval_required",
    });
    store.close();
  });

  it("rejects wrong-purpose signatures and snapshot rollback without partial writes", async () => {
    const policyKeys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_policy_fixture", policyKeys.privateKey);
    const first = snapshot();
    const second = snapshot({ sequence: 2, previousSnapshotId: first.snapshotId, decision: "deny" });
    const transport = new FixturePolicyTransport();
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    const store = await SQLitePolicyStateStore.open({ path: await databasePath(), target });
    transport.bundle = { snapshot: signer.signSnapshot(first), approvals: [], revocations: [] };
    await expect(sync({
      store,
      transport,
      publicKey: policyKeys.publicKey,
      clock,
      purposes: ["approval"],
    })).rejects.toMatchObject({ code: "policy_signer_purpose_denied" });
    await expect(store.getCurrentSnapshot()).resolves.toBeNull();

    await sync({ store, transport, publicKey: policyKeys.publicKey, clock });
    transport.bundle = { snapshot: signer.signSnapshot(second), approvals: [], revocations: [] };
    await sync({ store, transport, publicKey: policyKeys.publicKey, clock });
    transport.bundle = { snapshot: signer.signSnapshot(first), approvals: [], revocations: [] };
    await expect(sync({ store, transport, publicKey: policyKeys.publicKey, clock })).rejects.toMatchObject({
      code: "policy_store_failed",
    });
    await expect(store.getCurrentSnapshot()).resolves.toMatchObject({
      snapshot: { snapshotId: second.snapshotId, sequence: 2 },
    });
    store.close();
  });

  it("treats an authenticated Hub outage or wrong peer as no policy update", async () => {
    const policyKeys = generateKeyPairSync("ed25519");
    const transport = new FixturePolicyTransport();
    const store = await SQLitePolicyStateStore.open({ path: await databasePath(), target });
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    transport.offline = true;
    await expect(sync({ store, transport, publicKey: policyKeys.publicKey, clock })).resolves.toEqual({
      status: "offline",
      failureCode: "hub_unavailable",
    });
    transport.offline = false;
    transport.peerHash = `sha256:${"e".repeat(64)}`;
    await expect(sync({ store, transport, publicKey: policyKeys.publicKey, clock })).resolves.toEqual({
      status: "offline",
      failureCode: "transport_authentication_failed",
    });
    await expect(store.getCurrentSnapshot()).resolves.toBeNull();
    store.close();
  });
});
