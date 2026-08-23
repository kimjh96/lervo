import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import type { HubCommandArtifactStore, HubCommandSigner } from "@lervo/hub-command";
import { handleProjectRegistration } from "@lervo/hub-sync";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import {
  AuthenticatedRemoteCommandHttpTransport,
  AuthenticatedRemoteCommandHttpPayloadLoader,
  ConfiguredEd25519RemoteCommandTrustStore,
  Ed25519RemoteCommandSigner,
  RemoteCommandReceiver,
  runRemoteCommandReconnectCycle,
} from "@lervo/remote-command";
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
const writerToken = "hub-command-writer-token-cccccccccccccccccccccc";
const requestText = "Execute the task delivered over HTTP exactly once.";
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
    {
      token: writerToken,
      principalId: "operator:command-writer",
      permissions: ["command.write"],
      projects: [{ destinationId, projectId }],
    },
  ]);
}

async function start(
  store: HubSyncSQLiteStore,
  clock: MutableClock,
  maxRequestBytes?: number,
  authoring?: { artifacts: HubCommandArtifactStore; signer: HubCommandSigner },
): Promise<string> {
  const server = createHubServer({
    trace: { authenticator: authenticator(project().projectId), source: traceSource() },
    commands: {
      authenticator: authenticator(project().projectId),
      store,
      hubIdentityHash,
      now: () => clock.date(),
      ...(authoring === undefined ? {} : {
        authoring: { store, artifacts: authoring.artifacts, signer: authoring.signer },
      }),
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
    const clock = new MutableClock("2026-08-19T00:01:00.000Z");
    const artifacts = await OwnerOnlyFileSystemCas.open(resolve(root, "command-artifacts"));
    let baseUrl = await start(hub, clock, undefined, { artifacts, signer });
    const submissionUrl = new URL(`v1/commands/projects/${manifest.projectId}/submissions`, baseUrl);
    submissionUrl.searchParams.set("destinationId", destinationId);
    submissionUrl.searchParams.set("projectIdentityHash", target.projectIdentityHash);
    const submissionBody = {
      schemaVersion: 1,
      idempotencyKey: "idk_command_http_once_01",
      lifetimeMs: 300_000,
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      request: requestText,
    };
    const submit = (body: unknown) => fetch(submissionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${writerToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const firstSubmission = await submit(submissionBody);
    expect(firstSubmission.status).toBe(201);
    const firstSubmissionBody = await firstSubmission.json() as {
      deliveryId: string;
      envelope: { command: { commandId: string } };
    };
    const duplicateSubmission = await submit(submissionBody);
    expect(duplicateSubmission.status).toBe(200);
    const duplicateSubmissionBody = await duplicateSubmission.json() as typeof firstSubmissionBody & {
      status: string;
    };
    expect(duplicateSubmissionBody).toMatchObject({
      status: "duplicate",
      deliveryId: firstSubmissionBody.deliveryId,
      envelope: firstSubmissionBody.envelope,
    });
    await expect(submit({ ...submissionBody, request: "different request" }).then((response) => response.status))
      .resolves.toBe(409);
    const queued = { deliveryId: firstSubmissionBody.deliveryId };
    const inspection = new DatabaseSync(hubPath, { readOnly: true });
    const storedCoordinates = inspection.prepare(`
      SELECT authorship.*, command.envelope_json
      FROM hub_remote_command_authorships AS authorship
      JOIN hub_remote_commands AS command ON command.delivery_id = authorship.delivery_id
    `).get();
    inspection.close();
    expect(JSON.stringify(storedCoordinates)).not.toContain(requestText);
    expect(storedCoordinates).toMatchObject({
      idempotency_key: submissionBody.idempotencyKey,
      author_subject_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      artifact_uri: expect.stringMatching(/^lervo-cas:\/\/sha256\/[a-f0-9]{64}$/),
    });
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
      payloadLoader: new AuthenticatedRemoteCommandHttpPayloadLoader({
        baseUrl,
        bearerToken: nodeToken,
        expectedHubIdentityHash: hubIdentityHash,
        destinationId,
        nodeId,
        target,
        allowInsecureHttpForTests: true,
      }),
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
    baseUrl = await start(hub, clock, undefined, { artifacts, signer });

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
    const artifacts = await OwnerOnlyFileSystemCas.open(resolve(root, "bounded-command-artifacts"));
    const signer = new Ed25519RemoteCommandSigner(
      "key_command_http_02",
      generateKeyPairSync("ed25519").privateKey,
    );
    const baseUrl = await start(
      hub,
      new MutableClock("2026-08-19T00:01:00.000Z"),
      1_024,
      { artifacts, signer },
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

    const submissionUrl = new URL(`v1/commands/projects/${manifest.projectId}/submissions`, baseUrl);
    submissionUrl.searchParams.set("destinationId", destinationId);
    submissionUrl.searchParams.set("projectIdentityHash", target.projectIdentityHash);
    const submitOversized = (credential: string) => fetch(submissionUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: oversized,
    });
    await expect(submitOversized(observerToken).then((response) => response.status)).resolves.toBe(403);
    await expect(submitOversized(writerToken).then((response) => response.status)).resolves.toBe(413);

    const artifactUrl = new URL(
      `v1/commands/projects/${manifest.projectId}/artifacts/art_${"a".repeat(64)}`,
      baseUrl,
    );
    artifactUrl.searchParams.set("destinationId", destinationId);
    artifactUrl.searchParams.set("projectIdentityHash", target.projectIdentityHash);
    artifactUrl.searchParams.set("nodeId", nodeId);
    await expect(fetch(artifactUrl, {
      headers: { authorization: `Bearer ${observerToken}` },
    }).then((response) => response.status)).resolves.toBe(403);
    await expect(fetch(artifactUrl, {
      headers: { authorization: `Bearer ${nodeToken}` },
    }).then((response) => response.status)).resolves.toBe(404);
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
