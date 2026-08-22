import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import { ConfiguredBearerAuthenticator, createHubServer } from "@lervo/hub";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  AuthenticatedHubHttpTransport,
  type SyncHttpTransportOptions,
} from "@lervo/sync";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadNodeRuntimeConfig,
  openNodeRuntime,
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
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

const deployments: NodeRuntimeDeployment[] = [];
const servers: Server[] = [];
const hubStores: HubSyncSQLiteStore[] = [];

afterEach(async () => {
  await Promise.all(deployments.splice(0).map((deployment) => deployment.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error === undefined ? resolve() : reject(error))
  )));
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
  const authenticator = new ConfiguredBearerAuthenticator([{
    token: nodeRuntimeToken,
    principalId: "node:runtime-test",
    permissions: ["sync.write"],
    projects: [{ destinationId: nodeRuntimeDestinationId, projectId: nodeRuntimeProjectId }],
  }]);
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
  it("keeps outbox pending while offline, then synchronizes it after a daemon restart", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await nodeRuntimeFixture(root, port);
    const config = await loadNodeRuntimeConfig(fixture.configPath);
    let offline!: NodeRuntimeDeployment;
    offline = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      wait: {
        wait: async () => { queueMicrotask(() => { void offline.close(); }); },
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
          queueMicrotask(() => { void online.close(); });
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
        wait: async () => { signals.emit("SIGTERM"); },
      },
    });

    await expect(running).resolves.toBe(0);
    expect(stdout).toEqual(["Lervo Node 동기화가 시작됐습니다.\n"]);
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
      onCycle: () => { throw new Error("private observer failure"); },
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
});
