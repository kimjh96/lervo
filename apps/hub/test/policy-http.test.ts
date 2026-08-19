import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { handleProjectRegistration, handleRemoteCommandEnqueue } from "@lervo/hub-sync";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import {
  AuthenticatedPolicyHttpTransport,
  ConfiguredEd25519PolicyTrustStore,
  Ed25519PolicySigner,
  runPolicySyncCycle,
} from "@lervo/policy";
import { SQLitePolicyStateStore } from "@lervo/policy-sqlite";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConfiguredBearerAuthenticator,
  createHubServer,
} from "../src/index.js";
import { traceSource } from "./http-fixture.js";

const roots: string[] = [];
const servers: ReturnType<typeof createHubServer>[] = [];
const destinationId = "hub:policy-http";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const writerToken = "hub-policy-writer-token-aaaaaaaaaaaaaaaaaaaaaaaa";
const readerToken = "hub-policy-reader-token-bbbbbbbbbbbbbbbbbbbbbbbb";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done, reject) =>
    server.close((error) => error === undefined ? done() : reject(error))
  )));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "lervo-policy-http-"));
  roots.push(value);
  return value;
}

function project(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "prj_policy_http_01",
    name: "Policy HTTP fixture",
    root: ".",
    createdAt: "2026-08-19T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
  };
}

async function start(input: {
  store: HubSyncSQLiteStore;
  signer: Ed25519PolicySigner;
  now?: () => Date;
  maxRequestBytes?: number;
}): Promise<string> {
  const projectId = project().projectId;
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: writerToken,
      principalId: "operator:policy-writer",
      permissions: ["policy.read", "policy.write"],
      projects: [{ destinationId, projectId }],
    },
    {
      token: readerToken,
      principalId: "node:policy-reader",
      permissions: ["policy.read"],
      projects: [{ destinationId, projectId }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: traceSource() },
    policy: {
      authenticator,
      store: input.store,
      signer: input.signer,
      hubIdentityHash,
      now: input.now ?? (() => new Date("2026-08-19T00:05:00.000Z")),
      ...(input.maxRequestBytes === undefined ? {} : { maxRequestBytes: input.maxRequestBytes }),
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

function endpoint(base: string, kind: string, identityHash: string): string {
  const url = new URL(`v1/policy/projects/${project().projectId}/${kind}`, base);
  url.searchParams.set("destinationId", destinationId);
  url.searchParams.set("projectIdentityHash", identityHash);
  return url.href;
}

function json(token: string, body: unknown) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

describe("authenticated Hub policy HTTP vertical slice", () => {
  it("authors, persists, pulls and revokes policy through scoped HTTP", async () => {
    const fixtureRoot = await root();
    const hubPath = resolve(fixtureRoot, "hub.sqlite");
    const manifest = project();
    const identityHash = calculateProjectIdentityHash(manifest);
    const target = { projectId: manifest.projectId, projectIdentityHash: identityHash };
    const policyKeys = generateKeyPairSync("ed25519");
    const commandKeys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_policy_http_01", policyKeys.privateKey);
    const commandSigner = new Ed25519RemoteCommandSigner(
      "key_command_http_01",
      commandKeys.privateKey,
    );
    let hubStore = await HubSyncSQLiteStore.open({ path: hubPath });
    await handleProjectRegistration({
      store: hubStore,
      request: createProjectRegistrationRequest({ manifest, destinationId, requestedAt: "2026-08-19T00:00:00.000Z" }),
      acceptedAt: "2026-08-19T00:00:00.000Z",
    });
    const command = createRemoteCommand({
      idempotencyKey: "idk_policy_http_approval_01",
      nonce: Buffer.alloc(32, 8).toString("base64url"),
      issuedAt: "2026-08-19T00:00:00.000Z",
      expiresAt: "2026-08-19T00:50:00.000Z",
      target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_policy_http_request",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 24,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    await handleRemoteCommandEnqueue({
      store: hubStore,
      destinationId,
      envelope: commandSigner.sign(command),
      queuedAt: "2026-08-19T00:00:01.000Z",
    });
    let base = await start({ store: hubStore, signer });
    const snapshotUrl = endpoint(base, "snapshots", identityHash);
    const snapshotBody = {
      schemaVersion: 1,
      rules: [{
        ruleId: "polr_policy_http_write",
        roleId: "developer",
        risk: "medium",
        capability: "filesystem.write",
        repositoryPaths: ["src/result.ts"],
        decision: "require_approval",
      }],
      expiresAt: "2026-08-19T01:00:00.000Z",
    };

    expect((await fetch(snapshotUrl, json(readerToken, snapshotBody))).status).toBe(403);
    expect((await fetch(snapshotUrl, json("invalid-token-that-is-long-enough-000000", snapshotBody))).status)
      .toBe(401);
    expect((await fetch(snapshotUrl, json(writerToken, {
      ...snapshotBody,
      issuedAt: "2026-08-18T00:00:00.000Z",
    }))).status).toBe(400);
    await expect(hubStore.getCurrentPolicySnapshot({ destinationId, target })).resolves.toBeNull();

    const snapshotResponse = await fetch(snapshotUrl, json(writerToken, snapshotBody));
    expect(snapshotResponse.status).toBe(201);
    expect(snapshotResponse.headers.get("x-lervo-hub-identity")).toBe(hubIdentityHash);
    const snapshotResult = await snapshotResponse.json() as {
      result: { policySnapshotId: string };
    };
    await expect(hubStore.getCurrentPolicySnapshot({ destinationId, target })).resolves.toMatchObject({
      snapshot: { issuedAt: "2026-08-19T00:05:00.000Z" },
    });
    const approvalResponse = await fetch(endpoint(base, "approvals", identityHash), json(writerToken, {
      schemaVersion: 1,
      commandId: command.commandId,
      capability: "filesystem.write",
      repositoryPaths: ["src/result.ts"],
      expiresAt: "2026-08-19T00:40:00.000Z",
    }));
    expect(approvalResponse.status).toBe(201);
    const approvalResult = await approvalResponse.json() as {
      result: { originalId: string };
    };

    await new Promise<void>((done, reject) => servers.shift()!.close((error) =>
      error === undefined ? done() : reject(error)
    ));
    await hubStore.close();
    hubStore = await HubSyncSQLiteStore.open({ path: hubPath });
    base = await start({ store: hubStore, signer });

    const nodeStore = await SQLitePolicyStateStore.open({
      path: resolve(fixtureRoot, "node-policy.sqlite"),
      target,
    });
    const transport = new AuthenticatedPolicyHttpTransport({
      baseUrl: base,
      bearerToken: readerToken,
      expectedHubIdentityHash: hubIdentityHash,
      allowInsecureHttpForTests: true,
    });
    const trustStore = new ConfiguredEd25519PolicyTrustStore([{
      keyId: signer.keyId,
      publicKey: policyKeys.publicKey,
      projects: [target],
      purposes: ["snapshot", "approval", "revocation"],
    }]);
    await expect(runPolicySyncCycle({
      destinationId,
      expectedPeerIdentityHash: hubIdentityHash,
      target,
      transport,
      trustStore,
      store: nodeStore,
      clock: { now: () => "2026-08-19T00:06:00.000Z" },
    })).resolves.toMatchObject({
      status: "applied",
      snapshotId: snapshotResult.result.policySnapshotId,
      approvalCount: 1,
    });
    await expect(nodeStore.getApproval(approvalResult.result.originalId)).resolves.toMatchObject({
      revocation: null,
    });

    const revocationResponse = await fetch(endpoint(base, "revocations", identityHash), json(writerToken, {
      schemaVersion: 1,
      approvalId: approvalResult.result.originalId,
      reasonCode: "cancelled",
    }));
    expect(revocationResponse.status).toBe(201);
    await expect(runPolicySyncCycle({
      destinationId,
      expectedPeerIdentityHash: hubIdentityHash,
      target,
      transport,
      trustStore,
      store: nodeStore,
      clock: { now: () => "2026-08-19T00:08:00.000Z" },
    })).resolves.toMatchObject({ status: "applied", revocationCount: 1 });
    await expect(nodeStore.getApproval(approvalResult.result.originalId)).resolves.toMatchObject({
      revocation: { revocation: { reasonCode: "cancelled" } },
    });

    const stored = await hubStore.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: snapshotResult.result.policySnapshotId,
    });
    expect(JSON.stringify(stored)).not.toContain("operator:policy-writer");
    expect(stored).toMatchObject({
      approvals: [{ approval: { grantedAt: "2026-08-19T00:05:00.000Z" } }],
      revocations: [{ revocation: { revokedAt: "2026-08-19T00:05:00.000Z" } }],
    });
    await nodeStore.close();
    await hubStore.close();
  });

  it("bounds request bodies and reports a mismatched Hub identity as authentication failure", async () => {
    const fixtureRoot = await root();
    const manifest = project();
    const identityHash = calculateProjectIdentityHash(manifest);
    const target = { projectId: manifest.projectId, projectIdentityHash: identityHash };
    const keys = generateKeyPairSync("ed25519");
    const signer = new Ed25519PolicySigner("key_policy_http_02", keys.privateKey);
    const hubStore = await HubSyncSQLiteStore.open({ path: resolve(fixtureRoot, "hub.sqlite") });
    await handleProjectRegistration({
      store: hubStore,
      request: createProjectRegistrationRequest({ manifest, destinationId, requestedAt: "2026-08-19T00:00:00.000Z" }),
      acceptedAt: "2026-08-19T00:00:00.000Z",
    });
    const base = await start({ store: hubStore, signer, maxRequestBytes: 1_024 });
    const oversized = await fetch(endpoint(base, "snapshots", identityHash), json(writerToken, {
      schemaVersion: 1,
      rules: [],
      padding: "x".repeat(2_000),
      expiresAt: "2026-08-19T01:00:00.000Z",
    }));
    expect(oversized.status).toBe(413);

    const nodeStore = await SQLitePolicyStateStore.open({
      path: resolve(fixtureRoot, "node.sqlite"),
      target,
    });
    const wrongPeerTransport = new AuthenticatedPolicyHttpTransport({
      baseUrl: base,
      bearerToken: readerToken,
      expectedHubIdentityHash: `sha256:${"8".repeat(64)}`,
      allowInsecureHttpForTests: true,
    });
    await expect(runPolicySyncCycle({
      destinationId,
      expectedPeerIdentityHash: `sha256:${"8".repeat(64)}`,
      target,
      transport: wrongPeerTransport,
      trustStore: new ConfiguredEd25519PolicyTrustStore([{
        keyId: signer.keyId,
        publicKey: keys.publicKey,
        projects: [target],
        purposes: ["snapshot"],
      }]),
      store: nodeStore,
    })).resolves.toEqual({
      status: "offline",
      failureCode: "transport_authentication_failed",
    });
    const stalledFetch = ((
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
        once: true,
      });
    })) as typeof fetch;
    const timeoutTransport = new AuthenticatedPolicyHttpTransport({
      baseUrl: "https://hub.example.test/",
      bearerToken: readerToken,
      expectedHubIdentityHash: hubIdentityHash,
      requestTimeoutMs: 10,
      fetch: stalledFetch,
    });
    await expect(timeoutTransport.pullPolicyBundle({
      destinationId,
      target,
      currentSnapshotId: null,
      requestedAt: "2026-08-19T00:06:00.000Z",
    })).rejects.toThrow("request aborted");
    await nodeStore.close();
    await hubStore.close();
  });
});
