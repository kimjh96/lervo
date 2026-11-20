import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  knowledgeConvergenceHostRecordFacts,
  mergeKnowledgeConvergenceHostRecord,
  type ProviderCliAdmissionProjection,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { readConvergenceContinuityState } from "../src/continuity-state.js";
import {
  ConvergenceContinuity,
  type ConvergenceHostRecordPort,
} from "../src/convergence-continuity.js";
import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { readConvergenceOwnerHost } from "../src/convergence-owner-host.js";
import { CONVERGENCE_DELEGATION_PATH, loadConvergenceDelegation } from "../src/delegation.js";
import { FakeConvergenceOwnerHub } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const execute = promisify(execFile);
const DAY = 24 * 60 * 60_000;
const hub = {
  baseUrl: "https://hub.example/",
  bearerTokenFile: "/owner-only/hub-token",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface Host {
  label: "mac" | "wsl";
  root: string;
  storage: ProjectStorage;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

class FakeHostRecordHub {
  records = new Map<string, KnowledgeConvergenceHostRecord>();
  /** ADR-0602: the `knowledge` pushes each host has received and not yet handled. */
  pushes = new Map<string, number>();

  port(): ConvergenceHostRecordPort {
    return {
      publish: async (record) => {
        const current = this.records.get(record.hostHash) ?? null;
        const { next, status } = mergeKnowledgeConvergenceHostRecord({
          current,
          incoming: structuredClone(record),
        });
        this.records.set(record.hostHash, next);
        // As the Hub does: changed facts wake every other host, never the writer.
        if (
          status !== "stale" &&
          (current === null ||
            knowledgeConvergenceHostRecordFacts(current) !==
              knowledgeConvergenceHostRecordFacts(next))
        )
          for (const host of this.records.keys())
            if (host !== record.hostHash) this.pushes.set(host, (this.pushes.get(host) ?? 0) + 1);
        return status;
      },
      list: async () => [...this.records.values()].map((record) => structuredClone(record)),
    };
  }
}

async function openStorage(root: string): Promise<ProjectStorage> {
  const paths = resolveProjectPaths(root);
  await mkdir(paths.data, { recursive: true });
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion: 4,
  });
  const artifacts = await FileSystemCas.open(paths.cas);
  return {
    manifest,
    paths,
    events,
    artifacts,
    writableEventSchemaVersion: 4,
    close: async () => events.close(),
  };
}

/**
 * The incident's topology: the Mac and WSL checkouts of one repository hold the same tracked
 * files, agents, and delegation bytes (as the repository replica keeps them) and differ only in
 * host-local state. `trackDelegation` commits the delegation, as the plen history does.
 */
async function twoHosts(trackDelegation: boolean): Promise<{
  mac: Host;
  wsl: Host;
  policyPath: string;
}> {
  const f: Fixture = await fixture(true);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  if (trackDelegation) {
    await execute("git", ["-C", f.root, "add", "-f", CONVERGENCE_DELEGATION_PATH]);
    await execute("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "--quiet",
      "-m",
      "track the reviewed delegation",
    ]);
  }
  const wslRoot = resolve(f.directory, "wsl");
  await cp(f.root, wslRoot, { recursive: true });
  await rm(resolve(wslRoot, ".lervo/state"), { recursive: true, force: true });
  await rm(resolve(wslRoot, ".lervo/data"), { recursive: true, force: true });
  const wslStorage = await openStorage(wslRoot);
  cleanups.push(() => wslStorage.close());
  const policyPath = resolve(f.directory, "user-state", "knowledge-continuity-policy.json");
  return {
    mac: { label: "mac", root: f.root, storage: f.storage },
    wsl: { label: "wsl", root: wslRoot, storage: wslStorage },
    policyPath,
  };
}

function fleet(
  policyPath: string,
  clock: { now: number },
  providerAdmission: () => Promise<ProviderCliAdmissionProjection | null> = async () => null,
) {
  const records = new FakeHostRecordHub();
  const lease = new FakeConvergenceOwnerHub(() => clock.now);
  return {
    records,
    continuity: (host: Host) =>
      new ConvergenceContinuity({
        providerAdmission,
        storage: host.storage,
        policyPath,
        hubCandidates: async () => [{ source: "node_runtime" as const, hub }],
        transport: async () => records.port(),
        publication: async () => null,
        hostLabel: host.label,
        now: () => clock.now,
      }),
    ownership: (host: Host) =>
      new ConvergenceOwnership({
        storage: host.storage,
        provider: "claude",
        transport: async () => lease.port(),
        continuityPolicyPath: policyPath,
        now: () => clock.now,
      }),
  };
}

const bytes = (host: Host) => readFile(resolve(host.root, CONVERGENCE_DELEGATION_PATH), "utf8");
const continued = (host: Host) =>
  host.storage.events
    .list({ limit: 500 })
    .filter((event) => event.type === "knowledge.convergence.delegation.continued")
    .map((event) => event.payload as { action: string; source: string; sourceHostHash: unknown });

describe("host records pushed through the Hub (ADR-0602)", () => {
  it("stops two hosts from waking each other once their facts settle", async () => {
    const { mac, wsl, policyPath } = await twoHosts(false);
    const clock = { now: Date.now() };
    // Every observation stamps a new time deep inside the record, as provider admission does.
    const hosts = fleet(
      policyPath,
      clock,
      async () =>
        ({
          observedAt: new Date((clock.now += 1_000)).toISOString(),
          detectionFailure: null,
          providers: [],
          selected: null,
          waiting: false,
        }) as unknown as ProviderCliAdmissionProjection,
    );
    const byHash = new Map<string, Host>();
    for (const host of [mac, wsl]) {
      const state = await hosts.continuity(host).reconcile({ force: true });
      byHash.set(state!.hostHash!, host);
    }
    // Each push forces the woken host's reconciliation, as its resident's Hub wait does.
    let handled = 0;
    while (handled < 20) {
      const next = [...hosts.records.pushes.entries()].find(([, count]) => count > 0);
      if (next === undefined) break;
      hosts.records.pushes.set(next[0], 0);
      await hosts.continuity(byHash.get(next[0])!).reconcile({ force: true });
      handled += 1;
    }
    expect(handled).toBeLessThanOrEqual(2);
    expect([...hosts.records.pushes.values()].every((count) => count === 0)).toBe(true);
  });
});

describe("one writer per delegation renewal (ADR-0478)", () => {
  it("renews only on the owner and lets the follower adopt the identical bytes", async () => {
    const { mac, wsl, policyPath } = await twoHosts(false);
    const clock = { now: Date.now() };
    const hosts = fleet(policyPath, clock);
    const committed = await bytes(mac);
    // First cycle on each host: Hub mode, the standing policy, and no ownership verdict yet.
    await hosts.continuity(mac).reconcile();
    await hosts.continuity(wsl).reconcile();
    expect(await bytes(mac)).toBe(committed);
    expect(await bytes(wsl)).toBe(committed);
    expect((await hosts.ownership(mac).observe()).role).toBe("owner");
    expect((await hosts.ownership(wsl).observe()).role).toBe("waiting_owner");

    // The incident: WSL reconciled at 09:02 and the Mac at 09:14, inside one renewal window.
    const wslEarly = await hosts.continuity(wsl).reconcile({ force: true });
    expect(await bytes(wsl)).toBe(committed);
    expect(continued(wsl)).toEqual([]);
    expect(Date.parse(wslEarly!.nextReconcileAt!) - clock.now).toBeLessThanOrEqual(15 * 60_000);
    clock.now += 12 * 60_000;
    const macState = await hosts.continuity(mac).reconcile({ force: true });
    expect(macState?.lastContinuation).toMatchObject({ action: "renewed", source: "renewal" });
    const renewed = (await loadConvergenceDelegation(mac.root))!.delegation;
    const original = JSON.parse(committed) as { expiresAt: string; review: { reviewedAt: string } };
    expect(renewed.expiresAt).toBe(
      new Date(Date.parse(original.expiresAt) + 30 * DAY).toISOString(),
    );
    expect(renewed.review.reviewedAt).toBe(original.review.reviewedAt);

    clock.now += 60_000;
    const wslState = await hosts.continuity(wsl).reconcile({ force: true });
    expect(wslState?.lastContinuation).toMatchObject({ action: "adopted", source: "owner" });
    expect(await bytes(wsl)).toBe(await bytes(mac));
    const macHost = await readConvergenceOwnerHost(mac.root);
    expect(continued(wsl)).toEqual([
      expect.objectContaining({
        action: "adopted",
        source: "owner",
        sourceHostHash: macHost!.hostHash,
      }),
    ]);
    expect(continued(mac).map((event) => event.action)).toEqual(["renewed"]);

    // Nothing is due any more on either host, so nothing else is written.
    clock.now += 60_000;
    await hosts.continuity(mac).reconcile({ force: true });
    await hosts.continuity(wsl).reconcile({ force: true });
    expect(await bytes(wsl)).toBe(await bytes(mac));
    expect(continued(mac)).toHaveLength(1);
    expect(continued(wsl)).toHaveLength(1);
  });

  it("leaves a tracked delegation to the replica on the follower and renews it after a takeover", async () => {
    const { mac, wsl, policyPath } = await twoHosts(true);
    const clock = { now: Date.now() };
    const hosts = fleet(policyPath, clock);
    const committed = await bytes(mac);
    await hosts.continuity(mac).reconcile();
    await hosts.continuity(wsl).reconcile();
    expect((await hosts.ownership(mac).observe()).role).toBe("owner");
    expect((await hosts.ownership(wsl).observe()).role).toBe("waiting_owner");
    await hosts.continuity(mac).reconcile({ force: true });
    const ownerBytes = await bytes(mac);
    expect(ownerBytes).not.toBe(committed);

    // HEAD tracks the file, so the replica carries the owner's bytes; WSL writes nothing itself.
    const waiting = await hosts.continuity(wsl).reconcile({ force: true });
    expect(await bytes(wsl)).toBe(committed);
    expect(continued(wsl)).toEqual([]);
    expect(waiting?.lastContinuation).toBeNull();

    // The Mac stops, its lease lapses, and WSL takes over with its own, still-committed grant:
    // the delegation lapses too, yet a renewable grant keeps WSL eligible to claim and renew.
    clock.now = Date.parse((JSON.parse(committed) as { expiresAt: string }).expiresAt) + DAY;
    expect((await hosts.ownership(wsl).observe()).role).toBe("owner");
    const takeover = await hosts.continuity(wsl).reconcile({ force: true });
    expect(takeover?.lastContinuation).toMatchObject({ action: "renewed", source: "renewal" });
    // Renewal derives from the previous delegation and the policy alone, so the new owner wrote
    // exactly what the old owner had written.
    expect(await bytes(wsl)).toBe(ownerBytes);
    expect((await readConvergenceContinuityState(wsl.root))?.delegation.state).toBe("active");
  });
});
