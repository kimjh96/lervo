import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  HubKnowledgeChangeClient,
  HubKnowledgeConvergenceHostClient,
  HubKnowledgeConvergenceOwnerClient,
  HubKnowledgeConvergenceOwnerUnavailableError,
} from "@lervo/sync";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceScopeHash,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const destinationId = "hub:convergence-hosts";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const syncToken = "hub-convergence-hosts-sync-aaaaaaaaaaaaaaaaaaaaaa";
const traceToken = "hub-convergence-hosts-trace-bbbbbbbbbbbbbbbbbbbbb";
const otherProjectToken = "hub-convergence-hosts-other-cccccccccccccccccccc";
const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_convergence_hosts_http",
  name: "convergence-hosts-http",
  root: ".",
  createdAt: "2026-10-06T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};
const identity = calculateProjectIdentityHash(project);
const mac = `sha256:${"1".repeat(64)}`;
const wsl = `sha256:${"2".repeat(64)}`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A Node credential that holds only `sync.write`, as every Node credential already does. */
async function hub() {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-hub-convergence-hosts-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await HubSyncSQLiteStore.open({ path: resolve(directory, "hub.sqlite") });
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token: syncToken,
      principalId: "node:convergence-hosts",
      permissions: ["sync.write"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: traceToken,
      principalId: "node:convergence-hosts-trace",
      permissions: ["trace.read"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: otherProjectToken,
      principalId: "node:other-project",
      permissions: ["sync.write"],
      projects: [{ destinationId, projectId: "prj_some_other_project" }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: { authenticator, store, hubIdentityHash },
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await store.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

const target = (baseUrl: string, bearerToken: string) => ({
  baseUrl,
  bearerToken,
  destinationId,
  hubIdentityHash,
  projectId: project.projectId,
  repositoryIdentityHash: identity,
});

function hostRecord(hostHash: string, hostLabel: string, observedAt: string) {
  const scope = { canonicalRoots: ["docs"], providers: ["codex"] };
  const value: KnowledgeConvergenceHostRecord = {
    schemaVersion: 1,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
    hostHash,
    hostLabel,
    observedAt,
    delegation: {
      state: "active",
      expiresAt: "2026-10-07T19:00:00.000Z",
      scopeHash: knowledgeConvergenceScopeHash(scope),
      scope,
    },
    continuity: { policy: "active", horizonAt: null },
    owner: { role: "owner", reason: "lease_held" },
    publication: { configured: true, status: "idle" },
    resident: { state: "idle", reason: null },
    findings: [],
  };
  return value;
}

it("lets a sync.write Node credential exchange host records and claim the owner lease", async () => {
  const baseUrl = await hub();
  const hosts = new HubKnowledgeConvergenceHostClient(target(baseUrl, syncToken));
  expect(await hosts.publish(hostRecord(mac, "mac", "2026-10-06T01:00:00.000Z"))).toBe("created");
  expect(await hosts.publish(hostRecord(wsl, "wsl", "2026-10-06T01:00:00.000Z"))).toBe("created");
  expect(await hosts.publish(hostRecord(mac, "mac", "2026-10-06T00:00:00.000Z"))).toBe("stale");
  expect(await hosts.publish(hostRecord(mac, "mac", "2026-10-06T02:00:00.000Z"))).toBe("updated");
  expect((await hosts.list()).map((item) => item.hostLabel).sort()).toEqual(["mac", "wsl"]);
  const owner = new HubKnowledgeConvergenceOwnerClient(target(baseUrl, syncToken));
  expect(
    await owner.mutate({
      operation: "claim",
      request: {
        schemaVersion: 1,
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        hostHash: mac,
        hostLabel: "mac",
        ttlMs: 30 * 60_000,
      },
    }),
  ).toMatchObject({ status: "granted" });
});

it("still refuses principals without sync.write or outside the project scope", async () => {
  const baseUrl = await hub();
  for (const token of [traceToken, otherProjectToken]) {
    const failure = await new HubKnowledgeConvergenceHostClient(target(baseUrl, token))
      .list()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HubKnowledgeConvergenceOwnerUnavailableError);
    expect(failure).toMatchObject({ failureCode: "hub_forbidden", httpStatus: 403 });
  }
});

it(
  "wakes peers only for a host record whose facts changed, and lists each host's presence (ADR-0602)",
  { timeout: 30_000 },
  async () => {
    const baseUrl = await hub();
    const hosts = new HubKnowledgeConvergenceHostClient(target(baseUrl, syncToken));
    const changes = new HubKnowledgeChangeClient(target(baseUrl, syncToken));
    const stop = new AbortController();
    cleanups.push(async () => stop.abort());
    const hold = (cursor: string | null) => {
      const wait = changes.wait({ cursor, hostHash: wsl, signal: stop.signal });
      wait.catch(() => undefined);
      return wait;
    };
    const held = (wait: Promise<unknown>, milliseconds: number) =>
      Promise.race([
        wait.then(() => false),
        new Promise<boolean>((resolveHeld) => setTimeout(() => resolveHeld(true), milliseconds)),
      ]);
    const first = await hold(null);
    let waiting = hold(first.cursor);
    expect(await hosts.publish(hostRecord(mac, "mac", "2026-10-06T01:00:00.000Z"))).toBe("created");
    const created = await waiting;
    // The same facts observed again later wake nobody.
    waiting = hold(created.cursor);
    expect(await hosts.publish(hostRecord(mac, "mac", "2026-10-06T02:00:00.000Z"))).toBe("updated");
    expect(await held(waiting, 500)).toBe(true);
    const changed = {
      ...hostRecord(mac, "mac", "2026-10-06T03:00:00.000Z"),
      findings: ["peer_unreported"],
    };
    expect(await hosts.publish(changed)).toBe("updated");
    const woken = await waiting;
    expect(woken.cursor).not.toBe(created.cursor);
    waiting = hold(woken.cursor);
    expect(await hosts.publish(hostRecord(wsl, "wsl", "2026-10-06T03:00:00.000Z"))).toBe("created");
    // wsl holds a wait, mac does not; presence is the Hub's, never the record's.
    const listed = await hosts.list();
    expect(listed.find((item) => item.hostHash === wsl)?.presence).toMatchObject({
      connected: true,
    });
    // mac never waited (as an earlier release, which names no host): no presence, so peers
    // judge it by its record's age instead of reading it as gone.
    expect(listed.find((item) => item.hostHash === mac)?.presence).toBeUndefined();
    // wsl's own record never wakes wsl.
    expect(await held(waiting, 300)).toBe(true);
  },
);
