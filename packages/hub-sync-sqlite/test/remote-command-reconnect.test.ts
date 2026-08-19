import { createHash, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  handleRemoteCommandAcknowledgement,
  handleRemoteCommandEnqueue,
  handleRemoteCommandLease,
} from "@lervo/hub-sync";
import {
  AuthenticatedRemoteCommandHubTransport,
  ConfiguredEd25519RemoteCommandTrustStore,
  Ed25519RemoteCommandSigner,
  RemoteCommandReceiver,
  runRemoteCommandReconnectCycle,
} from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import { SQLiteRemoteCommandReplayStore } from "@lervo/remote-command-sqlite";
import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  databasePath,
  destinationId,
  manifest,
  registerStore,
  registration,
  removeTemporaryRoots,
} from "./fixture.js";

const peerIdentityHash = `sha256:${"c".repeat(64)}`;
const nodeId = "node_remote_fixture";
const requestText = "오프라인 명령을 한 번만 실행해 주세요.";
const requestBytes = new TextEncoder().encode(requestText);

class MutableClock {
  constructor(public value: string) {}
  now(): string { return this.value; }
}

class DirectRemoteCommandTransport implements AuthenticatedRemoteCommandHubTransport {
  offline = false;
  loseNextAcknowledgementBeforeCommit = false;

  constructor(
    public hub: HubSyncSQLiteStore,
    private readonly clock: MutableClock,
  ) {}

  private response(body: unknown) {
    return {
      authentication: {
        status: "verified" as const,
        destinationId,
        peerIdentityHash,
      },
      body,
    };
  }

  async pullRemoteCommands(input: Parameters<
    AuthenticatedRemoteCommandHubTransport["pullRemoteCommands"]
  >[0]): Promise<unknown> {
    if (this.offline) throw new Error("fixture Hub offline");
    return this.response(await handleRemoteCommandLease({
      store: this.hub,
      destinationId: input.destinationId,
      target: input.target,
      leasedTo: input.nodeId,
      leasedAt: input.requestedAt,
      leaseDurationMs: input.leaseDurationMs,
      limit: input.limit,
    }));
  }

  async acknowledgeRemoteCommand(
    acknowledgement: RemoteCommandDeliveryAcknowledgement,
  ): Promise<unknown> {
    if (this.offline || this.loseNextAcknowledgementBeforeCommit) {
      this.loseNextAcknowledgementBeforeCommit = false;
      throw new Error("fixture acknowledgement response lost before commit");
    }
    return this.response(await handleRemoteCommandAcknowledgement({
      store: this.hub,
      acknowledgement,
      confirmedAt: this.clock.value,
    }));
  }
}

function signedCommand(input: {
  project: ReturnType<typeof manifest>;
  signer: Ed25519RemoteCommandSigner;
  expiresAt?: string;
  idempotencyKey?: string;
  nonceByte?: number;
}): SignedRemoteCommand {
  const registrationRequest = registration(input.project);
  const command = createRemoteCommand({
    idempotencyKey: input.idempotencyKey ?? "idk_remote_offline_01",
    nonce: Buffer.alloc(32, input.nonceByte ?? 1).toString("base64url"),
    issuedAt: "2026-08-19T00:00:00.000Z",
    expiresAt: input.expiresAt ?? "2026-08-19T00:05:00.000Z",
    target: {
      projectId: input.project.projectId,
      projectIdentityHash: registrationRequest.projectIdentityHash,
    },
    action: {
      kind: "managed_run",
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      request: {
        artifactId: "art_remote_offline",
        contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
        byteCount: requestBytes.byteLength,
        mediaType: "text/plain; charset=utf-8",
      },
    },
  });
  return input.signer.sign(command);
}

function receiver(input: {
  target: RemoteCommandTarget;
  publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
  replayStore: SQLiteRemoteCommandReplayStore;
  clock: MutableClock;
  executor: ReturnType<typeof vi.fn>;
}) {
  return new RemoteCommandReceiver({
    target: input.target,
    trustStore: new ConfiguredEd25519RemoteCommandTrustStore([{
      keyId: "key_hub_fixture",
      publicKey: input.publicKey,
      projects: [input.target],
    }]),
    replayStore: input.replayStore,
    policy: { authorize: async () => ({ status: "approved" }) },
    payloadLoader: { load: async () => requestBytes },
    executor: {
      execute: async ({ request }) => {
        input.executor(request);
        return {
          runId: "run_remote_offline",
          completedAt: input.clock.value,
        };
      },
    },
    clock: input.clock,
  });
}

afterEach(removeTemporaryRoots);

describe("durable remote command offline queue and reconnect", () => {
  it("survives Hub and Node restart, then recovers a lost acknowledgement without re-execution", async () => {
    const project = manifest("prj_remote_offline");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = new Ed25519RemoteCommandSigner("key_hub_fixture", privateKey);
    const envelope = signedCommand({ project, signer });
    const target = envelope.command.target;
    const hubPath = await databasePath();
    let hub = await HubSyncSQLiteStore.open({ path: hubPath });
    await registerStore(hub, project);
    const queued = await handleRemoteCommandEnqueue({
      store: hub,
      destinationId,
      envelope,
      queuedAt: "2026-08-19T00:00:10.000Z",
    });
    await hub.close();

    hub = await HubSyncSQLiteStore.open({ path: hubPath });
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    const transport = new DirectRemoteCommandTransport(hub, clock);
    const replayPath = await databasePath();
    let replayStore = await SQLiteRemoteCommandReplayStore.open({ path: replayPath, target });
    const executor = vi.fn();
    let commandReceiver = receiver({ target, publicKey, replayStore, clock, executor });
    const workerOptions = () => ({
      destinationId,
      expectedPeerIdentityHash: peerIdentityHash,
      nodeId,
      target,
      transport,
      handler: commandReceiver,
      clock,
      leaseDurationMs: 30_000,
      retryDelayMs: 5_000,
    });

    transport.offline = true;
    await expect(runRemoteCommandReconnectCycle(workerOptions())).resolves.toMatchObject({
      status: "offline",
      failureCode: "hub_unavailable",
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "pending",
      attemptCount: 0,
    });

    transport.offline = false;
    transport.loseNextAcknowledgementBeforeCommit = true;
    await expect(runRemoteCommandReconnectCycle(workerOptions())).resolves.toMatchObject({
      status: "acknowledgement_pending",
      failureCode: "hub_unavailable",
      acknowledgedCount: 0,
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(requestText);
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "leased",
      attemptCount: 1,
    });

    replayStore.close();
    await hub.close();
    replayStore = await SQLiteRemoteCommandReplayStore.open({ path: replayPath, target });
    hub = await HubSyncSQLiteStore.open({ path: hubPath });
    transport.hub = hub;
    commandReceiver = receiver({ target, publicKey, replayStore, clock, executor });
    clock.value = "2026-08-19T00:01:31.000Z";

    await expect(runRemoteCommandReconnectCycle(workerOptions())).resolves.toMatchObject({
      status: "processed",
      acknowledgedCount: 1,
      executedCount: 0,
      failedCount: 0,
      duplicateCount: 1,
    });
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "completed",
      attemptCount: 2,
      terminalAt: clock.value,
    });

    replayStore.close();
    await hub.close();

    const hubDatabase = new DatabaseSync(hubPath);
    const hubOriginals = hubDatabase.prepare(`
      SELECT envelope_json, acknowledgement_json FROM hub_remote_commands
    `).get();
    expect(JSON.stringify(hubOriginals)).not.toContain(requestText);
    hubDatabase.close();
    const replayDatabase = new DatabaseSync(replayPath);
    const replayColumns = replayDatabase.prepare(
      "PRAGMA table_info(remote_command_replay)",
    ).all().map((row) => row.name);
    expect(replayColumns).toEqual([
      "idempotency_key",
      "command_hash",
      "nonce",
      "reservation_id",
      "receipt_json",
    ]);
    expect(JSON.stringify(replayDatabase.prepare(
      "SELECT * FROM remote_command_replay",
    ).all())).not.toContain(requestText);
    replayDatabase.close();
  });

  it("marks an offline command expired before leasing and never calls the Node handler", async () => {
    const project = manifest("prj_remote_expired");
    const { privateKey } = generateKeyPairSync("ed25519");
    const signer = new Ed25519RemoteCommandSigner("key_hub_fixture", privateKey);
    const envelope = signedCommand({
      project,
      signer,
      expiresAt: "2026-08-19T09:01:00.000+09:00",
      idempotencyKey: "idk_remote_expired_01",
      nonceByte: 2,
    });
    const hub = await HubSyncSQLiteStore.open({ path: await databasePath() });
    await registerStore(hub, project);
    const queued = await handleRemoteCommandEnqueue({
      store: hub,
      destinationId,
      envelope,
      queuedAt: "2026-08-19T09:00:10.000+09:00",
    });

    await expect(handleRemoteCommandLease({
      store: hub,
      destinationId,
      target: envelope.command.target,
      leasedTo: nodeId,
      leasedAt: "2026-08-19T00:02:00.000Z",
      leaseDurationMs: 30_000,
    })).resolves.toEqual([]);
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "expired",
      attemptCount: 0,
      terminalAt: "2026-08-19T00:02:00.000Z",
    });
    await hub.close();
  });

  it("records a forged signature as a terminal rejection without opening the executor", async () => {
    const project = manifest("prj_remote_rejected");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = new Ed25519RemoteCommandSigner("key_hub_fixture", privateKey);
    const valid = signedCommand({
      project,
      signer,
      idempotencyKey: "idk_remote_rejected_01",
      nonceByte: 3,
    });
    const signature = valid.signature.value;
    const envelope: SignedRemoteCommand = {
      ...valid,
      signature: {
        ...valid.signature,
        value: `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`,
      },
    };
    const target = envelope.command.target;
    const hub = await HubSyncSQLiteStore.open({ path: await databasePath() });
    await registerStore(hub, project);
    const queued = await handleRemoteCommandEnqueue({
      store: hub,
      destinationId,
      envelope,
      queuedAt: "2026-08-19T00:00:10.000Z",
    });
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    const transport = new DirectRemoteCommandTransport(hub, clock);
    const replayStore = await SQLiteRemoteCommandReplayStore.open({
      path: await databasePath(),
      target,
    });
    const executor = vi.fn();
    const commandReceiver = receiver({ target, publicKey, replayStore, clock, executor });

    await expect(runRemoteCommandReconnectCycle({
      destinationId,
      expectedPeerIdentityHash: peerIdentityHash,
      nodeId,
      target,
      transport,
      handler: commandReceiver,
      clock,
    })).resolves.toMatchObject({
      status: "processed",
      acknowledgedCount: 1,
      rejectedCount: 1,
      executedCount: 0,
      failedCount: 0,
    });
    expect(executor).not.toHaveBeenCalled();
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "rejected",
      attemptCount: 1,
    });

    replayStore.close();
    await hub.close();
  });
});
