import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  handleProjectRegistration,
  handleRemoteCommandEnqueue,
} from "@lervo/hub-sync";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import {
  AuthenticatedRemoteCommandHttpTransport,
  ConfiguredEd25519RemoteCommandTrustStore,
  Ed25519RemoteCommandSigner,
  RemoteCommandReceiver,
  runRemoteCommandReconnectCycle,
} from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import { SQLiteRemoteCommandReplayStore } from "@lervo/remote-command-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";
import { traceSource } from "./http-fixture.js";

const roots: string[] = [];
const servers: ReturnType<typeof createHubServer>[] = [];
const destinationId = "hub:command-http";
const nodeId = "node_command_http_01";
const hubIdentityHash = `sha256:${"7".repeat(64)}`;
const nodeToken = "hub-command-node-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const observerToken = "hub-command-observer-token-bbbbbbbbbbbbbbbbbbbbb";
const requestText = "HTTP로 전달된 작업을 한 번만 실행해 주세요.";
const requestBytes = new TextEncoder().encode(requestText);

class MutableClock {
  constructor(public value: string) {}
  now(): string { return this.value; }
  date(): Date { return new Date(this.value); }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done, reject) =>
    server.close((error) => error === undefined ? done() : reject(error))
  )));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "lervo-command-http-"));
  roots.push(value);
  return value;
}

function project(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "prj_command_http_01",
    name: "Command HTTP fixture",
    root: ".",
    createdAt: "2026-08-19T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
  };
}

function authenticator(projectId: string): ConfiguredBearerAuthenticator {
  return new ConfiguredBearerAuthenticator([
    {
      token: nodeToken,
      principalId: nodeId,
      permissions: ["command.delivery"],
      projects: [{ destinationId, projectId }],
    },
    {
      token: observerToken,
      principalId: "operator:command-observer",
      permissions: ["command.read"],
      projects: [{ destinationId, projectId }],
    },
  ]);
}

async function start(
  store: HubSyncSQLiteStore,
  clock: MutableClock,
  maxRequestBytes?: number,
): Promise<string> {
  const server = createHubServer({
    trace: { authenticator: authenticator(project().projectId), source: traceSource() },
    commands: {
      authenticator: authenticator(project().projectId),
      store,
      hubIdentityHash,
      now: () => clock.date(),
      ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
    },
  });
  servers.push(server);
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}

async function stopLatestServer(): Promise<void> {
  const server = servers.pop();
  if (server === undefined) return;
  await new Promise<void>((done, reject) => server.close((error) =>
    error === undefined ? done() : reject(error)
  ));
}

describe("authenticated remote command HTTP delivery", () => {
  it("recovers an acknowledgement loss across Hub and Node restart without re-execution", async () => {
    const root = await temporaryRoot();
    const manifest = project();
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    const keys = generateKeyPairSync("ed25519");
    const signer = new Ed25519RemoteCommandSigner("key_command_http_01", keys.privateKey);
    const command = createRemoteCommand({
      idempotencyKey: "idk_command_http_once_01",
      nonce: Buffer.alloc(32, 4).toString("base64url"),
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-19T00:05:00.000Z",
      target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_command_http_request",
          contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
          byteCount: requestBytes.byteLength,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    const envelope = signer.sign(command);
    const hubPath = resolve(root, "hub.sqlite");
    let hub = await HubSyncSQLiteStore.open({ path: hubPath });
    await handleProjectRegistration({
      store: hub,
      request: createProjectRegistrationRequest({
        manifest,
        destinationId,
        requestedAt: "2026-08-19T00:00:00.000Z",
      }),
      acceptedAt: "2026-08-19T00:00:00.000Z",
    });
    const queued = await handleRemoteCommandEnqueue({
      store: hub,
      destinationId,
      envelope,
      queuedAt: "2026-08-19T00:00:01.000Z",
    });
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    let baseUrl = await start(hub, clock);
    let dropAcknowledgement = true;
    const lossyFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (dropAcknowledgement && url.pathname.endsWith("/acknowledgements")) {
        dropAcknowledgement = false;
        throw new Error("fixture acknowledgement request lost");
      }
      return fetch(input, init);
    };
    const replayPath = resolve(root, "replay.sqlite");
    let replay = await SQLiteRemoteCommandReplayStore.open({ path: replayPath, target });
    const executor = vi.fn(async () => ({
      runId: "run_command_http_01",
      completedAt: clock.value,
    }));
    const makeReceiver = () => new RemoteCommandReceiver({
      target,
      trustStore: new ConfiguredEd25519RemoteCommandTrustStore([{
        keyId: signer.keyId,
        publicKey: keys.publicKey,
        projects: [target],
      }]),
      replayStore: replay,
      policy: { authorize: async () => ({ status: "approved" }) },
      payloadLoader: { load: async () => requestBytes },
      executor: { execute: executor },
      clock,
    });
    const makeTransport = (fetchImplementation?: typeof fetch) =>
      new AuthenticatedRemoteCommandHttpTransport({
        baseUrl,
        bearerToken: nodeToken,
        expectedHubIdentityHash: hubIdentityHash,
        destinationId,
        nodeId,
        target,
        allowInsecureHttpForTests: true,
        ...(fetchImplementation === undefined ? {} : { fetch: fetchImplementation }),
      });
    const worker = (transport: AuthenticatedRemoteCommandHttpTransport) => ({
      destinationId,
      expectedPeerIdentityHash: hubIdentityHash,
      nodeId,
      target,
      transport,
      handler: makeReceiver(),
      clock,
      leaseDurationMs: 30_000,
      retryDelayMs: 5_000,
    });

    await expect(runRemoteCommandReconnectCycle(worker(makeTransport(lossyFetch))))
      .resolves.toMatchObject({
        status: "acknowledgement_pending",
        acknowledgedCount: 0,
      });
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "leased",
      attemptCount: 1,
    });

    await stopLatestServer();
    replay.close();
    await hub.close();
    clock.value = "2026-08-19T00:01:31.000Z";
    hub = await HubSyncSQLiteStore.open({ path: hubPath });
    replay = await SQLiteRemoteCommandReplayStore.open({ path: replayPath, target });
    baseUrl = await start(hub, clock);

    await expect(runRemoteCommandReconnectCycle(worker(makeTransport()))).resolves.toMatchObject({
      status: "processed",
      executedCount: 0,
      duplicateCount: 1,
      acknowledgedCount: 1,
    });
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(hub.getRemoteCommandDelivery(queued.deliveryId)).resolves.toMatchObject({
      status: "completed",
      attemptCount: 2,
      terminalAt: clock.value,
    });
    replay.close();
    await hub.close();
  });

  it("authenticates and scopes the Node before reading a bounded request body", async () => {
    const root = await temporaryRoot();
    const manifest = project();
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    const hub = await HubSyncSQLiteStore.open({ path: resolve(root, "hub.sqlite") });
    await handleProjectRegistration({
      store: hub,
      request: createProjectRegistrationRequest({
        manifest,
        destinationId,
        requestedAt: "2026-08-19T00:00:00.000Z",
      }),
      acceptedAt: "2026-08-19T00:00:00.000Z",
    });
    const baseUrl = await start(
      hub,
      new MutableClock("2026-08-19T00:01:00.000Z"),
      1_024,
    );
    const url = new URL(`v1/commands/projects/${manifest.projectId}/leases`, baseUrl);
    url.searchParams.set("destinationId", destinationId);
    url.searchParams.set("projectIdentityHash", target.projectIdentityHash);
    url.searchParams.set("nodeId", nodeId);
    const oversized = JSON.stringify({ schemaVersion: 1, padding: "x".repeat(2_000) });
    const request = (token: string, body: string) => fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });

    await expect(request(observerToken, oversized).then((response) => response.status)).resolves.toBe(403);
    await expect(request(nodeToken, oversized).then((response) => response.status)).resolves.toBe(413);
    const wrongNode = new URL(url);
    wrongNode.searchParams.set("nodeId", "node_command_http_02");
    await expect(fetch(wrongNode, {
      method: "POST",
      headers: { authorization: `Bearer ${nodeToken}`, "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, leaseDurationMs: 30_000, limit: 1 }),
    }).then((response) => response.status)).resolves.toBe(403);

    const wrongPeer = new AuthenticatedRemoteCommandHttpTransport({
      baseUrl,
      bearerToken: nodeToken,
      expectedHubIdentityHash: `sha256:${"6".repeat(64)}`,
      destinationId,
      nodeId,
      target,
      allowInsecureHttpForTests: true,
    });
    await expect(runRemoteCommandReconnectCycle({
      destinationId,
      expectedPeerIdentityHash: `sha256:${"6".repeat(64)}`,
      nodeId,
      target,
      transport: wrongPeer,
      handler: { handle: vi.fn() },
      clock: { now: () => "2026-08-19T00:01:00.001Z" },
    })).resolves.toMatchObject({
      status: "offline",
      failureCode: "transport_authentication_failed",
    });
    await hub.close();
  });
});
