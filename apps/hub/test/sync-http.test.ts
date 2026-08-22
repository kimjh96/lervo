import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore, type EventDraft } from "@lervo/event-store-sqlite";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  AuthenticatedHubHttpTransport,
  runOutboundSyncCycle,
  type SyncClock,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const roots: string[] = [];
const servers: ReturnType<typeof createHubServer>[] = [];
const hubStores: HubSyncSQLiteStore[] = [];
const destinationId = "hub:sync-http-integration";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const syncToken = "hub-sync-integration-token-aaaaaaaaaaaaaaaaaaaa";
const traceOnlyToken = "hub-sync-trace-only-token-bbbbbbbbbbbbbbbbbbbb";
const policyVersion = `sha256:${"a".repeat(64)}`;

class MutableClock implements SyncClock {
  constructor(public value = "2026-08-22T02:00:00.000Z") {}
  now(): string { return this.value; }
}

function manifest(): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId: "prj_sync_http_full_01",
    name: "sync-http-full",
    root: ".",
    createdAt: "2026-08-22T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
  };
}

function draft(seq: number, projectId: string): EventDraft {
  return {
    eventId: `evt_sync_http_full_${String(seq).padStart(2, "0")}`,
    projectId,
    runId: "run_sync_http_full_01",
    sessionId: "ses_sync_http_full_01",
    type: "run.requested",
    occurredAt: `2026-08-22T00:00:0${seq}.000Z`,
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      requestDigest: `sha256:${String(seq).padStart(64, "0")}`,
      role: "developer",
      risk: "low",
    },
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-sync-http-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) =>
    server.close((error) => error === undefined ? resolve() : reject(error))
  )));
  await Promise.all(hubStores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function start(store: HubSyncSQLiteStore, project: ProjectManifest): Promise<string> {
  const authenticator = new ConfiguredBearerAuthenticator([{
    token: syncToken,
    principalId: "node:sync-http",
    permissions: ["sync.write", "trace.read"],
    projects: [{ destinationId, projectId: project.projectId }],
  }, {
    token: traceOnlyToken,
    principalId: "operator:trace-only",
    permissions: ["trace.read"],
    projects: [{ destinationId, projectId: project.projectId }],
  }]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: {
      authenticator,
      store,
      hubIdentityHash,
      now: () => new Date("2026-08-22T02:00:00.000Z"),
    },
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/`;
}

describe("authenticated Hub event sync HTTP", () => {
  it("recovers a lost committed acknowledgement through the actual Node worker and Hub SQLite", async () => {
    const root = await fixtureRoot();
    const project = manifest();
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const local = await SQLiteEventStore.open({
      path: resolve(root, "local.sqlite"),
      projectId: project.projectId,
    });
    for (let seq = 1; seq <= 2; seq += 1) {
      local.transact((transaction) => {
        const event = transaction.append(draft(seq, project.projectId)).event;
        transaction.enqueue({
          eventId: event.eventId,
          destinationId,
          enqueuedAt: `2026-08-22T00:01:0${seq}.000Z`,
        });
      });
    }
    const hub = await HubSyncSQLiteStore.open({ path: resolve(root, "hub.sqlite") });
    hubStores.push(hub);
    const baseUrl = await start(hub, project);
    let loseFirstAcknowledgement = true;
    const lossyFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (loseFirstAcknowledgement && url.pathname.endsWith("/event-batches")) {
        loseFirstAcknowledgement = false;
        await response.arrayBuffer();
        throw new Error("fixture lost response after Hub commit");
      }
      return response;
    };
    const transport = new AuthenticatedHubHttpTransport({
      baseUrl,
      bearerToken: syncToken,
      expectedHubIdentityHash: hubIdentityHash,
      destinationId,
      target,
      allowInsecureHttpForTests: true,
      fetch: lossyFetch,
    });
    const clock = new MutableClock();
    const options = {
      store: local,
      transport,
      manifest: project,
      destinationId,
      expectedPeerIdentityHash: hubIdentityHash,
      workerId: "node:sync-http-worker",
      clock,
      retryDelayMs: 1_000,
    };

    await expect(runOutboundSyncCycle(options)).resolves.toMatchObject({
      status: "retry_scheduled",
      failureCode: "hub_unavailable",
      rescheduledCount: 2,
    });
    expect(local.listOutbox({ status: "pending" })).toHaveLength(2);
    clock.value = "2026-08-22T02:00:01.000Z";
    await expect(runOutboundSyncCycle(options)).resolves.toMatchObject({
      status: "synchronized",
      registrationStatus: "unchanged",
      acknowledgedCount: 2,
      cursor: { seq: 2 },
    });
    expect(local.listOutbox({ status: "acknowledged" })).toHaveLength(2);
    await expect(hub.auditIntegrity()).resolves.toEqual({
      valid: true,
      projectCount: 1,
      eventCount: 2,
    });
    local.close();
  });

  it("checks project permission and URL identity before accepting a body", async () => {
    const root = await fixtureRoot();
    const project = manifest();
    const hub = await HubSyncSQLiteStore.open({ path: resolve(root, "hub.sqlite") });
    hubStores.push(hub);
    const baseUrl = await start(hub, project);
    const registration = createProjectRegistrationRequest({
      manifest: project,
      destinationId,
      requestedAt: "2026-08-22T02:00:00.000Z",
    });
    const endpoint = new URL(
      `v1/sync/projects/${project.projectId}/registration`,
      baseUrl,
    );
    endpoint.searchParams.set("destinationId", destinationId);
    endpoint.searchParams.set("projectIdentityHash", registration.projectIdentityHash);
    const forbidden = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${traceOnlyToken}`,
        "content-type": "application/json",
      },
      body: "not-json-secret-that-must-not-be-read",
    });
    expect(forbidden.status).toBe(403);

    endpoint.searchParams.set("projectIdentityHash", `sha256:${"8".repeat(64)}`);
    const drift = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${syncToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(registration),
    });
    expect(drift.status).toBe(400);
    await expect(hub.auditIntegrity()).resolves.toEqual({
      valid: true,
      projectCount: 0,
      eventCount: 0,
    });
  });
});
