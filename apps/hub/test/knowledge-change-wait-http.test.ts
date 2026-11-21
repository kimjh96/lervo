import { mkdtemp, rm } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
import {
  HubKnowledgeChangeClient,
  HubKnowledgeConvergenceOwnerClient,
  HubKnowledgeConvergenceOwnerUnavailableError,
} from "@lervo/sync";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";

const destinationId = "hub:knowledge-changes";
const hubIdentityHash = `sha256:${"9".repeat(64)}`;
const token = "hub-knowledge-change-token-aaaaaaaaaaaaaaaaaaaaaa";
const traceOnlyToken = "hub-knowledge-change-trace-bbbbbbbbbbbbbbbbbbbbb";
const project: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_knowledge_change_http",
  name: "knowledge-change-http",
  root: ".",
  createdAt: "2026-11-20T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};
const identity = calculateProjectIdentityHash(project);
const mac = `sha256:${"1".repeat(64)}`;
const wsl = `sha256:${"2".repeat(64)}`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function hub(clock: { now: number | null } = { now: null }) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-knowledge-changes-"));
  const store = await HubSyncSQLiteStore.open({ path: resolve(root, "hub.sqlite") });
  const authenticator = new ConfiguredBearerAuthenticator([
    {
      token,
      principalId: "node:knowledge-changes",
      permissions: ["workspace.read", "workspace.coordinate"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
    {
      token: traceOnlyToken,
      principalId: "operator:trace-only",
      permissions: ["trace.read"],
      projects: [{ destinationId, projectId: project.projectId }],
    },
  ]);
  const server = createHubServer({
    trace: { authenticator, source: store },
    sync: {
      authenticator,
      store,
      hubIdentityHash,
      now: () => new Date(clock.now ?? Date.now()),
    },
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  const target = {
    baseUrl,
    destinationId,
    hubIdentityHash,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
  };
  return {
    changes: (bearerToken = token) => new HubKnowledgeChangeClient({ ...target, bearerToken }),
    owner: new HubKnowledgeConvergenceOwnerClient({ ...target, bearerToken: token }),
  };
}

const claim = (hostHash: string, hostLabel: string) => ({
  operation: "claim" as const,
  request: {
    schemaVersion: 1 as const,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
    hostHash,
    hostLabel,
    ttlMs: 30 * 60_000,
  },
});

/** Whether `wait` is still held after `milliseconds`; it is left running either way. */
async function heldFor(wait: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    wait.then(() => false),
    new Promise<boolean>((resolveHeld) => setTimeout(() => resolveHeld(true), milliseconds)),
  ]);
}

it(
  "holds a knowledge wait open and wakes another host for a new holder and a release, not a renewal (ADR-0602)",
  { timeout: 60_000 },
  async () => {
    const running = await hub();
    const changes = running.changes();
    const stop = new AbortController();
    cleanups.push(async () => stop.abort());
    const hold = (hostHash: string, cursor: string | null) => {
      const wait = changes.wait({ cursor, hostHash, signal: stop.signal });
      wait.catch(() => undefined);
      return wait;
    };
    // Each host's first hold is a connection its peer sees, so let presence settle first.
    let wsl0 = await hold(wsl, null);
    let mac0 = await hold(mac, null);
    let wslWait = hold(wsl, wsl0.cursor);
    mac0 = await hold(mac, mac0.cursor);
    const macWait = hold(mac, mac0.cursor);
    wsl0 = await wslWait;
    const wslCursor = wsl0.cursor;
    wslWait = hold(wsl, wslCursor);
    // Both holds stay open with nothing changed; the Hub arms no timeout for them.
    expect(await heldFor(wslWait, 300)).toBe(true);
    // mac's claim wakes wsl, never mac itself.
    await expect(running.owner.mutate(claim(mac, "mac"))).resolves.toMatchObject({
      status: "granted",
    });
    const granted = await wslWait;
    expect(granted.cursor).not.toBe(wslCursor);
    // The answer names what changed, so wsl runs a full cycle for a lease change.
    expect(granted.kinds).toContain("lease");
    expect(await heldFor(macWait, 300)).toBe(true);
    // A renewal changes nothing a peer acts on.
    wslWait = hold(wsl, granted.cursor);
    await expect(running.owner.mutate(claim(mac, "mac"))).resolves.toMatchObject({
      status: "renewed",
    });
    expect(await heldFor(wslWait, 500)).toBe(true);
    // The release wakes the waiting host at once.
    const generation = (await running.owner.read()).lease!.generation;
    await running.owner.mutate({
      operation: "release",
      request: {
        schemaVersion: 1,
        projectId: project.projectId,
        repositoryIdentityHash: identity,
        hostHash: mac,
        generation,
      },
    });
    const started = Date.now();
    const released = await wslWait;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(released.cursor).not.toBe(granted.cursor);
    expect(released.kinds).toEqual(["lease"]);
    expect(await heldFor(macWait, 200)).toBe(true);
  },
);

it("refuses a knowledge wait without a coordination permission", async () => {
  const running = await hub();
  await expect(
    running
      .changes(traceOnlyToken)
      .wait({ cursor: null, hostHash: wsl, signal: new AbortController().signal }),
  ).rejects.toMatchObject({
    constructor: HubKnowledgeConvergenceOwnerUnavailableError,
    failureCode: "hub_forbidden",
  });
});

it("names an unreachable Hub as unreachable", async () => {
  const client = new HubKnowledgeChangeClient({
    baseUrl: "http://127.0.0.1:9/",
    bearerToken: token,
    destinationId,
    hubIdentityHash,
    projectId: project.projectId,
    repositoryIdentityHash: identity,
  });
  await expect(
    client.wait({ cursor: null, hostHash: wsl, signal: new AbortController().signal }),
  ).rejects.toMatchObject({ failureCode: "hub_unreachable" });
});

it(
  "keeps a present holder's lease live, and never hands it to a peer while the holder's own validity lasts (ADR-0602)",
  { timeout: 60_000 },
  async () => {
    const clock: { now: number | null } = { now: null };
    const running = await hub(clock);
    const changes = running.changes();
    const macWait = new AbortController();
    const stop = new AbortController();
    cleanups.push(async () => {
      macWait.abort();
      stop.abort();
    });
    await expect(running.owner.mutate(claim(mac, "mac"))).resolves.toMatchObject({
      status: "granted",
    });
    // mac holds its knowledge wait, as its resident does.
    const first = await changes.wait({ cursor: null, hostHash: mac, signal: macWait.signal });
    changes
      .wait({ cursor: first.cursor, hostHash: mac, signal: macWait.signal })
      .catch(() => undefined);
    await new Promise((settle) => setTimeout(settle, 200));
    // Long past the thirty-minute lease, with no renewal: the present holder still holds it.
    clock.now = Date.now() + 2 * 60 * 60_000;
    const refused = await running.owner.mutate(claim(wsl, "wsl"));
    expect(refused).toMatchObject({ status: "held_elsewhere", holderPresent: true });
    // wsl waits; mac's resident stops, and after the presence grace wsl is woken.
    const wslFirst = await changes.wait({ cursor: null, hostHash: wsl, signal: stop.signal });
    const wslWait = changes.wait({ cursor: wslFirst.cursor, hostHash: wsl, signal: stop.signal });
    wslWait.catch(() => undefined);
    // wsl's own arrival wakes mac only; drain any presence change before mac leaves.
    clock.now = null;
    macWait.abort();
    const woken = await wslWait;
    expect(woken.cursor).not.toBe(wslFirst.cursor);
    const reading = await running.owner.read();
    expect(reading).toMatchObject({ status: "held", holderPresent: false });
    // The Hub saw mac leave while mac still held the validity of its last claim (thirty minutes,
    // minus its safety margin). A one-sided drop leaves mac able to commit until then, so the
    // expiry is never pulled below it: a peer one minute later is still refused.
    const left = Date.parse(reading.lease!.expiresAt) - Date.now();
    expect(left).toBeGreaterThan(29 * 60_000);
    expect(left).toBeLessThanOrEqual(30 * 60_000);
    clock.now = Date.now() + 61_000;
    await expect(running.owner.mutate(claim(wsl, "wsl"))).resolves.toMatchObject({
      status: "held_elsewhere",
      holderPresent: false,
    });
    clock.now = Date.parse(reading.lease!.expiresAt) + 1;
    await expect(running.owner.mutate(claim(wsl, "wsl"))).resolves.toMatchObject({
      status: "granted",
    });
  },
);
