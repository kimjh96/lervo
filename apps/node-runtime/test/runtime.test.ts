import { EventEmitter } from "node:events";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { resolve } from "node:path";

import {
  ConfiguredBearerAuthenticator,
  ReloadableBearerAuthenticator,
  createHubServer,
} from "@lervo/hub";
import { FileSystemCas } from "@lervo/cas";
import { canonicalJson } from "@lervo/event-contract";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { Ed25519PolicySigner } from "@lervo/policy";
import { createPolicySnapshot } from "@lervo/policy-contract";
import { loadProjectManifest } from "@lervo/project";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import {
  createRemoteCommand,
  createRemoteCommandDeliveryConfirmation,
  createRemoteCommandLease,
} from "@lervo/remote-command-contract";
import { type RemoteCommandDeliveryAcknowledgement, type WorkstreamSnapshot } from "@lervo/schemas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  AuthenticatedHubHttpTransport,
  runOutboundSyncCycle,
  runWorkstreamReplicationCycle,
  type SyncHttpTransportOptions,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadNodeRuntimeConfig,
  openNodeRuntime,
  NodeWorkstreamReplicationLocalPort,
  parseNodeRuntimeConfig,
  runNodeRuntimeCli,
  type NodeRuntimeDeployment,
} from "../src/index.js";
import {
  availablePort,
  nodeRuntimeDestinationId,
  nodeRuntimeFixture,
  nodeRuntimeHubIdentityHash,
  nodeRuntimeProjectId,
  nodeRuntimeToken,
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

const deployments: NodeRuntimeDeployment[] = [];
const servers: Server[] = [];
const hubStores: HubSyncSQLiteStore[] = [];
const rotatedNodeRuntimeToken = "node-runtime-token-bbbbbbbbbbbbbbbbbbbbbbbbbb";
const secondaryNodeRuntimeDestinationId = "hub:node-runtime-test:secondary";

afterEach(async () => {
  await Promise.all(deployments.splice(0).map((deployment) => deployment.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      ),
  );
  await Promise.all(hubStores.splice(0).map((store) => store.close()));
  await removeTemporaryRoots();
});

function localHttpTransport(options: SyncHttpTransportOptions): AuthenticatedHubHttpTransport {
  return new AuthenticatedHubHttpTransport({
    ...options,
    baseUrl: options.baseUrl.replace(/^https:/, "http:"),
    allowInsecureHttpForTests: true,
  });
}

async function startHub(path: string, port: number): Promise<HubSyncSQLiteStore> {
  const store = await HubSyncSQLiteStore.open({ path });
  hubStores.push(store);
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: nodeRuntimeToken,
      principalId: "node:runtime-test",
      permissions: ["sync.write", "workstream.read", "workstream.write"],
      projects: [
        { destinationId: nodeRuntimeDestinationId, projectId: nodeRuntimeProjectId },
        { destinationId: secondaryNodeRuntimeDestinationId, projectId: nodeRuntimeProjectId },
      ],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: { authenticator, store, hubIdentityHash: nodeRuntimeHubIdentityHash },
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return store;
}

describe("installed Node sync runtime", () => {
  it("automatically publishes a workstream and imports it on another authorized repository node", async () => {
    const hubRoot = await temporaryRoot();
    const port = await availablePort();
    const firstRoot = await temporaryRoot();
    const secondRoot = await temporaryRoot();
    const firstFixture = await nodeRuntimeFixture(firstRoot, port);
    const secondFixture = await nodeRuntimeFixture(secondRoot, port);
    const secondConfig = structuredClone(secondFixture.value) as Record<string, unknown> & {
      hub: { destinationId: string };
    };
    secondConfig.hub.destinationId = secondaryNodeRuntimeDestinationId;
    await ownerFile(secondFixture.configPath, JSON.stringify(secondConfig));
    const snapshot: WorkstreamSnapshot = {
      schemaVersion: 1,
      workstreamId: "wks_1234567890abcdef12345678",
      revision: 1,
      status: "active",
      title: "Hub continuation",
      objective: "Resume the exact active task on another authorized repository node.",
      nextActions: ["Continue the verified implementation."],
      blockers: [],
      notes: ["The Hub transports bounded continuation state, not user authority."],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      origin: {
        kind: "created",
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
      },
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    const content = `${canonicalJson(snapshot)}\n`;
    const snapshotContentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const workstreamPath = resolve(
      firstFixture.repositoryRoot,
      ".lervo/state/workstreams/current.json",
    );
    await mkdir(resolve(workstreamPath, ".."), { recursive: true });
    await writeFile(workstreamPath, content);
    const artifacts = await FileSystemCas.open(
      resolve(firstFixture.repositoryRoot, ".lervo/data/cas"),
    );
    await artifacts.put(content);
    const events = await SQLiteEventStore.open({
      path: firstFixture.databasePath,
      projectId: nodeRuntimeProjectId,
    });
    events.append({
      eventId: "evt_node_workstream_seed_01",
      projectId: nodeRuntimeProjectId,
      runId: "run_node_workstream_seed_01",
      sessionId: "ses_node_workstream_seed_01",
      type: "workstream.snapshot.recorded",
      occurredAt: "2026-08-24T00:00:00.000Z",
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 1,
      policyVersion: snapshotContentHash,
      payload: {
        workstreamId: snapshot.workstreamId,
        revision: snapshot.revision,
        status: snapshot.status,
        changeKind: "agent_start",
        snapshotArtifactId: `art_${snapshotContentHash.slice("sha256:".length)}`,
        snapshotContentHash,
        previousSnapshotContentHash: null,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    events.close();

    const hub = await startHub(`${hubRoot}/hub.sqlite`, port);
    const runOneCycle = async (fixture: typeof firstFixture, destination: string) => {
      const project = await loadProjectManifest(fixture.repositoryRoot);
      const target = {
        projectId: project.projectId,
        projectIdentityHash: calculateProjectIdentityHash(project),
      };
      const transport = localHttpTransport({
        baseUrl: `https://127.0.0.1:${port}/`,
        bearerToken: nodeRuntimeToken,
        expectedHubIdentityHash: nodeRuntimeHubIdentityHash,
        destinationId: destination,
        target,
      });
      const registration = createProjectRegistrationRequest({
        manifest: project,
        destinationId: destination,
        requestedAt: "2026-08-24T00:00:00.000Z",
      });
      await transport.registerProject(registration);
      const localEvents = await SQLiteEventStore.open({
        path: fixture.databasePath,
        projectId: project.projectId,
      });
      const localArtifacts = await FileSystemCas.open(
        resolve(fixture.repositoryRoot, ".lervo/data/cas"),
      );
      const local = new NodeWorkstreamReplicationLocalPort(
        fixture.repositoryRoot,
        project.projectId,
        localEvents,
        localArtifacts,
      );
      try {
        await runOutboundSyncCycle({
          store: localEvents,
          transport,
          manifest: project,
          destinationId: destination,
          expectedPeerIdentityHash: nodeRuntimeHubIdentityHash,
          workerId: "node:workstream-integration",
        });
        return await runWorkstreamReplicationCycle({
          local,
          transport,
          registration,
          destinationId: destination,
          expectedPeerIdentityHash: nodeRuntimeHubIdentityHash,
        });
      } finally {
        localEvents.close();
      }
    };
    await expect(runOneCycle(firstFixture, nodeRuntimeDestinationId)).resolves.toMatchObject({
      status: "published",
      publishedCount: 1,
    });
    await expect(
      hub.readWorkstream({
        destinationId: nodeRuntimeDestinationId,
        projectId: nodeRuntimeProjectId,
        repositoryIdentityHash: calculateProjectIdentityHash(
          await loadProjectManifest(firstFixture.repositoryRoot),
        ),
      }),
    ).resolves.toMatchObject({ status: "current", snapshot });

    let secondNode!: NodeRuntimeDeployment;
    secondNode = await openNodeRuntime(await loadNodeRuntimeConfig(secondFixture.configPath), {
      createTransport: localHttpTransport,
      onCycle(result) {
        if (result.status === "idle" || result.status === "synchronized") {
          queueMicrotask(() => {
            void secondNode.close();
          });
        }
      },
    });
    deployments.push(secondNode);
    await secondNode.start();
    await expect(secondNode.closed).resolves.toMatchObject({ status: "stopped" });
    await expect(
      readFile(
        resolve(secondFixture.repositoryRoot, ".lervo/state/workstreams/current.json"),
        "utf8",
      ),
    ).resolves.toBe(content);
    const importedEvents = await SQLiteEventStore.open({
      path: secondFixture.databasePath,
      projectId: nodeRuntimeProjectId,
    });
    expect(importedEvents.list({ afterSeq: 0, limit: 100 }).at(-1)?.payload).toMatchObject({
      workstreamId: snapshot.workstreamId,
      snapshotContentHash,
      changeKind: "hub_replication_import",
    });
    importedEvents.close();
  });

  it("reloads the external command and policy trust snapshot as one runtime operation", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    const firstCommand = generateKeyPairSync("ed25519");
    const firstPolicy = generateKeyPairSync("ed25519");
    const nextCommand = generateKeyPairSync("ed25519");
    const nextPolicy = generateKeyPairSync("ed25519");
    const publicPem = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) =>
      String(key.export({ type: "spki", format: "pem" }));
    await Promise.all([
      ownerFile(resolve(keyDirectory, "command-01.pem"), publicPem(firstCommand.publicKey)),
      ownerFile(resolve(keyDirectory, "policy-01.pem"), publicPem(firstPolicy.publicKey)),
      ownerFile(resolve(keyDirectory, "command-02.pem"), publicPem(nextCommand.publicKey)),
      ownerFile(resolve(keyDirectory, "policy-02.pem"), publicPem(nextPolicy.publicKey)),
    ]);
    const trustPath = resolve(root, "node-trust.json");
    const snapshot = (suffix: "01" | "02") => ({
      schemaVersion: 1,
      commandKeys: [
        {
          keyId: `key_command_runtime_${suffix}`,
          publicKeyFile: `keys/command-${suffix}.pem`,
        },
      ],
      policyKeys: [
        {
          keyId: `key_policy_runtime_${suffix}`,
          publicKeyFile: `keys/policy-${suffix}.pem`,
          purposes: ["snapshot", "approval", "revocation"],
        },
      ],
    });
    await ownerFile(trustPath, JSON.stringify(snapshot("01")));
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_runtime_control_01",
      trustFile: "node-trust.json",
      idlePollIntervalMs: 100,
      retryDelayMs: 1_000,
    };
    const deployment = await openNodeRuntime(parseNodeRuntimeConfig(configured, root), {
      createTransport: localHttpTransport,
      remoteCommands: {
        executor: {
          execute: async () => ({
            runId: "run_node_runtime_reload_01",
            completedAt: "2026-08-22T00:00:00.000Z",
          }),
        },
        localPolicy: { resolve: async () => [] },
      },
    });
    deployments.push(deployment);
    await ownerFile(trustPath, JSON.stringify(snapshot("02")));
    const first = deployment.reloadRuntimeMaterials();
    const second = deployment.reloadRuntimeMaterials();
    expect(second).toBe(first);
    await first;

    await ownerFile(resolve(keyDirectory, "command-02.pem"), publicPem(firstCommand.publicKey));
    await expect(deployment.reloadRuntimeMaterials()).rejects.toMatchObject({
      code: "runtime_material_reload_failed",
    });
    let closed = false;
    void deployment.closed.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
  });

  it("atomically reloads its bearer token for later requests and retains the prior token on failure", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await nodeRuntimeFixture(root, port);
    const store = await HubSyncSQLiteStore.open({ path: `${root}/hub.sqlite` });
    hubStores.push(store);
    const credential = (token: string) => ({
      token,
      principalId: "node:runtime-test",
      permissions: ["sync.write" as const, "workstream.read" as const, "workstream.write" as const],
      projects: [{ destinationId: nodeRuntimeDestinationId, projectId: nodeRuntimeProjectId }],
    });
    const authenticator = new ReloadableBearerAuthenticator([credential(nodeRuntimeToken)]);
    const server = createHubServer({
      trace: { authenticator, source: store },
      sync: { authenticator, store, hubIdentityHash: nodeRuntimeHubIdentityHash },
    });
    servers.push(server);
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolvePromise);
    });

    const observedTokens: string[] = [];
    let phase = "initial" as "initial" | "rotated" | "done";
    let deployment!: NodeRuntimeDeployment;
    deployment = await openNodeRuntime(await loadNodeRuntimeConfig(fixture.configPath), {
      createTransport(options) {
        observedTokens.push(options.bearerToken);
        return localHttpTransport(options);
      },
      async onCycle() {
        if (phase === "initial") {
          phase = "rotated";
          authenticator.replace([credential(rotatedNodeRuntimeToken)]);
          await ownerFile(resolve(root, "hub.token"), `${rotatedNodeRuntimeToken}\n`);
          const first = deployment.reloadBearerToken();
          const second = deployment.reloadBearerToken();
          expect(second).toBe(first);
          await first;
          await ownerFile(resolve(root, "hub.token"), "invalid\n");
          await expect(deployment.reloadBearerToken()).rejects.toMatchObject({
            code: "token_reload_failed",
          });
          return;
        }
        if (phase === "rotated" && observedTokens.includes(rotatedNodeRuntimeToken)) {
          phase = "done";
          queueMicrotask(() => {
            void deployment.close();
          });
        }
      },
    });
    deployments.push(deployment);
    await deployment.start();
    await expect(deployment.closed).resolves.toMatchObject({ status: "stopped" });
    expect(phase).toBe("done");
    expect(observedTokens).toContain(nodeRuntimeToken);
    expect(observedTokens).toContain(rotatedNodeRuntimeToken);
    expect(observedTokens.at(-1)).toBe(rotatedNodeRuntimeToken);
  });

  it("keeps outbox pending while offline, then synchronizes it after a daemon restart", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await nodeRuntimeFixture(root, port);
    const config = await loadNodeRuntimeConfig(fixture.configPath);
    let offline!: NodeRuntimeDeployment;
    offline = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      wait: {
        wait: async () => {
          queueMicrotask(() => {
            void offline.close();
          });
        },
      },
    });
    deployments.push(offline);
    await offline.start();
    await expect(offline.closed).resolves.toMatchObject({
      status: "stopped",
      sync: { lastCycle: { status: "registration_deferred", failureCode: "hub_unavailable" } },
    });
    const pending = await SQLiteEventStore.open({
      path: fixture.databasePath,
      projectId: nodeRuntimeProjectId,
    });
    expect(pending.listOutbox({ status: "pending" })).toHaveLength(1);
    pending.close();

    const hub = await startHub(`${root}/hub.sqlite`, port);
    let online!: NodeRuntimeDeployment;
    online = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      onCycle(result) {
        if (result.status === "synchronized") {
          queueMicrotask(() => {
            void online.close();
          });
        }
      },
    });
    deployments.push(online);
    await online.start();
    await expect(online.closed).resolves.toMatchObject({
      status: "stopped",
      sync: {
        lastCycle: { status: "synchronized", acknowledgedCount: 1 },
      },
    });
    await expect(hub.auditIntegrity()).resolves.toEqual({
      valid: true,
      projectCount: 1,
      eventCount: 1,
    });
    const acknowledged = await SQLiteEventStore.open({
      path: fixture.databasePath,
      projectId: nodeRuntimeProjectId,
    });
    expect(acknowledged.listOutbox({ status: "acknowledged" })).toHaveLength(1);
    acknowledged.close();
  });

  it("stops from SIGTERM without printing repository, identity, or token", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const signals = new EventEmitter();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const running = runNodeRuntimeCli(["--config", fixture.configPath], {
      cwd: root,
      signals,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      createTransport: localHttpTransport,
      wait: {
        wait: async () => {
          signals.emit("SIGTERM");
        },
      },
    });

    await expect(running).resolves.toBe(0);
    expect(stdout).toEqual(["Lervo Node synchronization started.\n"]);
    expect(stderr).toEqual([]);
    const output = [...stdout, ...stderr].join("");
    expect(output).not.toContain(root);
    expect(output).not.toContain(nodeRuntimeHubIdentityHash);
    expect(output).not.toContain(nodeRuntimeToken);
  });

  it("fails the process boundary when a cycle observer cannot finish", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const deployment = await openNodeRuntime(await loadNodeRuntimeConfig(fixture.configPath), {
      createTransport: localHttpTransport,
      onCycle: () => {
        throw new Error("private observer failure");
      },
    });
    deployments.push(deployment);
    await deployment.start();
    await expect(deployment.closed).resolves.toMatchObject({
      status: "failed",
      failureCode: "sync_runtime_failed",
    });
    const reopened = await SQLiteEventStore.open({
      path: fixture.databasePath,
      projectId: nodeRuntimeProjectId,
    });
    expect(reopened.listOutbox({ status: "pending" })).toHaveLength(1);
    reopened.close();
  });

  it("syncs signed policy before commands and does not execute again after restart", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const commandKeys = generateKeyPairSync("ed25519");
    const policyKeys = generateKeyPairSync("ed25519");
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    await ownerFile(
      resolve(keyDirectory, "command.pem"),
      String(
        commandKeys.publicKey.export({
          type: "spki",
          format: "pem",
        }),
      ),
    );
    await ownerFile(
      resolve(keyDirectory, "policy.pem"),
      String(
        policyKeys.publicKey.export({
          type: "spki",
          format: "pem",
        }),
      ),
    );
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_runtime_control_01",
      commandKeys: [{ keyId: "key_command_runtime_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [
        {
          keyId: "key_policy_runtime_01",
          publicKeyFile: "keys/policy.pem",
          purposes: ["snapshot", "approval", "revocation"],
        },
      ],
      idlePollIntervalMs: 100,
      retryDelayMs: 1_000,
      maxLifetimeMs: 15 * 60_000,
    };
    const config = parseNodeRuntimeConfig(configured, root);
    const manifest = await loadProjectManifest(fixture.repositoryRoot);
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    const request = "Execute exactly once even after restart.";
    const requestBytes = new TextEncoder().encode(request);
    const commandSigner = new Ed25519RemoteCommandSigner(
      "key_command_runtime_01",
      commandKeys.privateKey,
    );
    const envelope = commandSigner.sign(
      createRemoteCommand({
        idempotencyKey: "idk_node_runtime_control_01",
        nonce: Buffer.alloc(32, 4).toString("base64url"),
        issuedAt: "2026-08-22T00:00:00.000Z",
        expiresAt: "2026-08-22T00:10:00.000Z",
        target,
        action: {
          kind: "managed_run",
          roleId: "developer",
          provider: "codex",
          risk: "medium",
          verificationSuiteIds: ["repo.check"],
          request: {
            artifactId: "art_node_runtime_control_01",
            contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
            byteCount: requestBytes.byteLength,
            mediaType: "text/plain; charset=utf-8",
          },
        },
      }),
    );
    const policySigner = new Ed25519PolicySigner("key_policy_runtime_01", policyKeys.privateKey);
    const bundle = {
      snapshot: policySigner.signSnapshot(
        createPolicySnapshot({
          target,
          sequence: 1,
          previousSnapshotId: null,
          issuedAt: "2026-08-22T00:00:00.000Z",
          expiresAt: "2026-08-22T01:00:00.000Z",
          rules: [
            {
              ruleId: "polr_node_runtime_control_01",
              roleId: "developer",
              risk: "medium",
              capability: "filesystem.write",
              repositoryPaths: ["src/result.ts"],
              decision: "allow",
            },
          ],
        }),
      ),
      approvals: [],
      revocations: [],
    };
    const clock = {
      value: "2026-08-22T00:01:00.000Z",
      now() {
        return this.value;
      },
    };
    let loseAcknowledgement = true;
    let leaseSequence = 0;
    const executor = vi.fn(async () => ({
      runId: "run_node_runtime_control_01",
      completedAt: clock.value,
    }));
    const remotePorts = () => ({
      executor: { execute: executor },
      localPolicy: {
        resolve: async () => [
          { capability: "filesystem.write" as const, decision: "allow" as const },
        ],
      },
      clock,
      createPolicyTransport: () => ({
        pullPolicyBundle: async (input: { destinationId: string }) => ({
          authentication: {
            status: "verified" as const,
            destinationId: input.destinationId,
            peerIdentityHash: nodeRuntimeHubIdentityHash,
          },
          body: bundle,
        }),
      }),
      createCommandTransport: () => ({
        pullRemoteCommands: async (input: { destinationId: string; nodeId: string }) => {
          leaseSequence += 1;
          const leasedAt = clock.value;
          const lease = createRemoteCommandLease({
            destinationId: input.destinationId,
            leaseId: `rcl_${Buffer.alloc(32, leaseSequence).toString("base64url")}`,
            leasedTo: input.nodeId,
            leasedAt,
            leaseExpiresAt: new Date(Date.parse(leasedAt) + 30_000).toISOString(),
            envelope,
          });
          return {
            authentication: {
              status: "verified" as const,
              destinationId: input.destinationId,
              peerIdentityHash: nodeRuntimeHubIdentityHash,
            },
            body: [lease],
          };
        },
        acknowledgeRemoteCommand: async (acknowledgement: RemoteCommandDeliveryAcknowledgement) => {
          if (loseAcknowledgement) {
            loseAcknowledgement = false;
            throw new Error("fixture acknowledgement lost");
          }
          return {
            authentication: {
              status: "verified" as const,
              destinationId: nodeRuntimeDestinationId,
              peerIdentityHash: nodeRuntimeHubIdentityHash,
            },
            body: createRemoteCommandDeliveryConfirmation({
              acknowledgement,
              status: "accepted",
              confirmedAt: clock.value,
            }),
          };
        },
      }),
      createPayloadLoader: () => ({ load: async () => requestBytes }),
    });

    let first!: NodeRuntimeDeployment;
    first = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      remoteCommands: {
        ...remotePorts(),
        onCycle: () => {
          queueMicrotask(() => {
            void first.close();
          });
        },
      },
    });
    deployments.push(first);
    await first.start();
    await expect(first.closed).resolves.toMatchObject({
      status: "stopped",
      remoteControl: {
        lastCycle: { command: { status: "acknowledgement_pending" } },
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ request }));

    clock.value = "2026-08-22T00:01:31.000Z";
    let second!: NodeRuntimeDeployment;
    second = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      remoteCommands: {
        ...remotePorts(),
        onCycle: () => {
          queueMicrotask(() => {
            void second.close();
          });
        },
      },
    });
    deployments.push(second);
    await second.start();
    await expect(second.closed).resolves.toMatchObject({
      status: "stopped",
      remoteControl: {
        lastCycle: {
          policy: { status: "duplicate" },
          command: { status: "processed", duplicateCount: 1, executedCount: 0 },
        },
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
