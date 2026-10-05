import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { ProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { knowledgeOutputCommitGrant } from "../src/convergence-owner-fence.js";
import { CONVERGENCE_OWNER_LEASE_TTL_MS } from "../src/convergence-owner-verdict.js";
import { commitFreshnessPaths } from "../src/freshness-commit.js";
import { fixture } from "./fixture.js";
import { FakeConvergenceOwnerHub, peerHost, writeHostConfig } from "./convergence-owner-hosts.js";

const execute = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Host {
  label: string;
  root: string;
  storage: ProjectStorage;
  ownership: () => ConvergenceOwnership;
}

async function twoHosts(options: { peerMode?: "hub" | "standalone" } = {}) {
  // Starts at the real time so commit paths, which read the wall clock, see the same instant.
  let clock = Date.now();
  const now = () => clock;
  const hub = new FakeConvergenceOwnerHub(now);
  const f = await fixture(true);
  const peer = await peerHost({ sourceRoot: f.root, directory: f.directory });
  cleanups.push(async () => {
    await f.storage.close();
    await peer.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  });
  await writeHostConfig(f.root, { hostId: `hst_${"1".repeat(32)}`, label: "mac", mode: "hub" });
  await writeHostConfig(peer.root, {
    hostId: `hst_${"2".repeat(32)}`,
    label: "wsl",
    mode: options.peerMode ?? "hub",
  });
  const host = (label: string, root: string, storage: ProjectStorage): Host => ({
    label,
    root,
    storage,
    // A fresh instance per call models a process restart; durable state lives in the fence.
    ownership: () =>
      new ConvergenceOwnership({
        storage,
        provider: "claude",
        transport: async () => hub.port(),
        now,
      }),
  });
  return {
    hub,
    mac: host("mac", f.root, f.storage),
    wsl: host("wsl", peer.root, peer.storage),
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    now,
  };
}

function ownerEvents(storage: ProjectStorage) {
  return storage.events
    .list({ limit: 100 })
    .filter((event) => event.type === "knowledge.convergence.owner.changed")
    .map((event) => event.payload as Record<string, unknown>);
}

async function grants(hosts: Host[], now: number) {
  return Promise.all(hosts.map((host) => knowledgeOutputCommitGrant(host.root, now)));
}

describe("cross-host convergence ownership", () => {
  it(
    "grants one owner, keeps the peer read-only with the holder label, and survives restarts",
    { timeout: 120_000 },
    async () => {
      const { hub, mac, wsl, now } = await twoHosts();
      const first = await mac.ownership().observe();
      expect(first).toMatchObject({ role: "owner", reason: "lease_granted", mode: "hub" });
      const waiting = await wsl.ownership().observe();
      expect(waiting).toMatchObject({
        role: "waiting_owner",
        reason: "convergence_owner_elsewhere",
        holder: { label: "mac", generation: 1 },
      });
      expect(Date.parse(waiting.wakeAt!)).toBe(now() + CONVERGENCE_OWNER_LEASE_TTL_MS + 5_000);
      const [macGrant, wslGrant] = await grants([mac, wsl], now());
      expect(macGrant).toEqual({ allowed: true, hostHash: first.hostHash });
      expect(wslGrant).toEqual({ allowed: false, reason: "convergence_owner_elsewhere" });

      // A deploy restart on the owner keeps the same lease without contacting the Hub again.
      const requests = hub.requests;
      expect(await mac.ownership().observe()).toMatchObject({
        role: "owner",
        reason: "lease_held",
        holder: { generation: 1 },
      });
      expect(hub.requests).toBe(requests);

      expect(ownerEvents(mac.storage)).toEqual([
        expect.objectContaining({
          holderHostHash: first.hostHash,
          previousHolderHostHash: null,
          observerHostHash: first.hostHash,
          generation: 1,
          mode: "hub",
          reason: "lease",
        }),
      ]);
      expect(ownerEvents(wsl.storage)).toEqual([
        expect.objectContaining({
          holderHostHash: first.hostHash,
          observerHostHash: waiting.hostHash,
          generation: 1,
          reason: "lease",
        }),
      ]);
      const serialized = JSON.stringify([ownerEvents(mac.storage), ownerEvents(wsl.storage)]);
      expect(serialized).not.toContain("mac");
      expect(serialized).not.toContain("hub.invalid");
    },
  );

  it(
    "renews by heartbeat and hands ownership to the peer only after the lease expires",
    { timeout: 120_000 },
    async () => {
      const { mac, wsl, advance, now } = await twoHosts();
      const macOwnership = mac.ownership();
      const wslOwnership = wsl.ownership();
      const owner = await macOwnership.observe();
      await wslOwnership.observe();

      // Heartbeats renew after a third of the lease; the peer keeps waiting.
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 3);
      expect(await macOwnership.observe()).toMatchObject({
        role: "owner",
        reason: "lease_renewed",
      });
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 2);
      expect(await wslOwnership.observe()).toMatchObject({ role: "waiting_owner" });

      // The owner stops renewing (crash). Its local validity ends before the Hub expiry.
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS);
      expect((await grants([mac, wsl], now())).map((grant) => grant.allowed)).toEqual([
        false,
        false,
      ]);
      const takeover = await wslOwnership.observe();
      expect(takeover).toMatchObject({
        role: "owner",
        reason: "lease_granted",
        holder: { label: "wsl", generation: 2 },
      });
      expect(ownerEvents(wsl.storage).at(-1)).toMatchObject({
        holderHostHash: takeover.hostHash,
        previousHolderHostHash: owner.hostHash,
        generation: 2,
        reason: "expiry",
      });
      expect(await macOwnership.observe()).toMatchObject({
        role: "waiting_owner",
        holder: { label: "wsl", generation: 2 },
      });
      expect((await grants([mac, wsl], now())).map((grant) => grant.allowed)).toEqual([
        false,
        true,
      ]);
    },
  );

  it(
    "keeps a proven lease through a Hub outage, then degrades explicitly instead of standalone",
    { timeout: 120_000 },
    async () => {
      const { hub, mac, wsl, advance, now } = await twoHosts();
      const macOwnership = mac.ownership();
      await macOwnership.observe();
      hub.available = false;
      expect(await wsl.ownership().observe()).toMatchObject({
        role: "unverifiable",
        reason: "convergence_owner_unverifiable",
      });
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 2);
      expect(await macOwnership.observe()).toMatchObject({
        role: "owner",
        reason: "hub_unavailable_within_lease",
      });
      expect((await grants([mac, wsl], now())).map((grant) => grant.allowed)).toEqual([
        true,
        false,
      ]);
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 2);
      expect(await macOwnership.observe()).toMatchObject({
        role: "unverifiable",
        reason: "convergence_owner_unverifiable",
      });
      expect((await grants([mac, wsl], now())).map((grant) => grant.allowed)).toEqual([
        false,
        false,
      ]);
      hub.available = true;
      expect(await wsl.ownership().observe()).toMatchObject({
        role: "owner",
        holder: { generation: 2 },
      });
    },
  );

  it(
    "releases on request, yields for one lease lifetime, and lets the peer claim at once",
    { timeout: 120_000 },
    async () => {
      const { mac, wsl, advance } = await twoHosts();
      const owner = await mac.ownership().observe();
      await wsl.ownership().observe();
      expect(await mac.ownership().release()).toMatchObject({
        hubReleased: true,
        verdict: { role: "yielding", reason: "convergence_owner_released" },
      });
      expect(ownerEvents(mac.storage).at(-1)).toMatchObject({
        holderHostHash: null,
        previousHolderHostHash: owner.hostHash,
        reason: "release",
      });
      expect(await mac.ownership().observe()).toMatchObject({ role: "yielding" });
      expect(await wsl.ownership().observe()).toMatchObject({
        role: "owner",
        holder: { label: "wsl", generation: 2 },
      });
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 2);
      expect(await wsl.ownership().observe()).toMatchObject({ reason: "lease_renewed" });
      advance(CONVERGENCE_OWNER_LEASE_TTL_MS / 2 + 1);
      expect(await mac.ownership().observe()).toMatchObject({
        role: "waiting_owner",
        holder: { label: "wsl" },
      });
    },
  );

  it(
    "releases the lease when the owner's delegation is withdrawn",
    { timeout: 120_000 },
    async () => {
      const { mac, wsl } = await twoHosts();
      await mac.ownership().observe();
      await rm(resolve(mac.root, ".lervo/knowledge/convergence-delegation.json"));
      expect(await mac.ownership().observe()).toMatchObject({
        role: "ineligible",
        reason: "knowledge_authority_unavailable",
      });
      expect(ownerEvents(mac.storage).at(-1)).toMatchObject({ reason: "delegation" });
      expect(await wsl.ownership().observe()).toMatchObject({ role: "owner" });
    },
  );

  it(
    "never commits knowledge outputs on the non-owner and names the owner in its commit",
    { timeout: 120_000 },
    async () => {
      const { mac, wsl } = await twoHosts();
      const owner = await mac.ownership().observe();
      await wsl.ownership().observe();
      const commit = (host: Host) =>
        commitFreshnessPaths({
          repositoryRoot: host.root,
          paths: ["docs/specs/runtime.md"],
          subject: "docs: refresh runtime",
          trailer: { key: "Lervo-Freshness-Candidate", candidateId: "kfresh_fixture" },
        });
      for (const host of [mac, wsl])
        await writeFile(
          resolve(host.root, "docs/specs/runtime.md"),
          `# Runtime\n\nRefreshed on ${host.label}.\n`,
        );
      const [macCommit, wslCommit] = [await commit(mac), await commit(wsl)];
      expect(macCommit).toMatch(/^[a-f0-9]{40}$/u);
      expect(wslCommit).toBeNull();
      const { stdout } = await execute("git", ["-C", mac.root, "log", "-1", "--format=%B"]);
      expect(stdout).toContain(`Lervo-Convergence-Host: ${owner.hostHash}`);
      // The non-owner's bytes stay in its working tree for the owner, never in its history.
      expect(await readFile(resolve(wsl.root, "docs/specs/runtime.md"), "utf8")).toContain("wsl");
      const { stdout: wslLog } = await execute("git", ["-C", wsl.root, "log", "--format=%an"]);
      expect(wslLog).not.toContain("Lervo Knowledge");
    },
  );

  it(
    "surfaces contention when a standalone host sees another host's fresh knowledge commit",
    { timeout: 120_000 },
    async () => {
      const { mac, wsl } = await twoHosts({ peerMode: "standalone" });
      const clock = () => Date.now();
      const realMac = new ConvergenceOwnership({
        storage: mac.storage,
        provider: "claude",
        transport: async () => new FakeConvergenceOwnerHub(clock).port(),
        now: clock,
      });
      const owner = await realMac.observe();
      expect(
        await new ConvergenceOwnership({
          storage: wsl.storage,
          provider: "claude",
          now: clock,
        }).observe(),
      ).toMatchObject({ role: "owner", reason: "standalone_owner", mode: "standalone" });
      await writeFile(resolve(mac.root, "docs/specs/runtime.md"), "# Runtime\n\nOwner edit.\n");
      expect(
        await commitFreshnessPaths({
          repositoryRoot: mac.root,
          paths: ["docs/specs/runtime.md"],
          subject: "docs: refresh runtime",
          trailer: { key: "Lervo-Freshness-Candidate", candidateId: "kfresh_fixture" },
        }),
      ).not.toBeNull();
      await execute("git", ["-C", wsl.root, "pull", "--quiet", "--ff-only", "origin", "main"]);
      const contended = await new ConvergenceOwnership({
        storage: wsl.storage,
        provider: "claude",
        now: clock,
      }).observe();
      expect(contended).toMatchObject({
        role: "contended",
        reason: "convergence_owner_contended",
        holder: { hostHash: owner.hostHash },
      });
      expect(await knowledgeOutputCommitGrant(wsl.root)).toEqual({
        allowed: false,
        reason: "convergence_owner_contended",
      });
    },
  );

  it("fails closed on an invalid host configuration", { timeout: 120_000 }, async () => {
    const { mac } = await twoHosts();
    await writeFile(
      resolve(mac.root, ".lervo/state/knowledge/convergence-owner-host.json"),
      '{"schemaVersion":1}',
    );
    expect(await mac.ownership().observe()).toMatchObject({
      role: "unverifiable",
      reason: "convergence_owner_host_invalid",
    });
    expect(await knowledgeOutputCommitGrant(mac.root)).toMatchObject({ allowed: false });
  });
});
