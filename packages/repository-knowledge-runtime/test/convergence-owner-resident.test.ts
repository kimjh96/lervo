import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import { CONVERGENCE_OWNER_LEASE_TTL_MS } from "../src/convergence-owner-verdict.js";

import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { inspectKnowledgeResidentHealth } from "../src/resident-health.js";
import { fixture } from "./fixture.js";
import { FakeConvergenceOwnerHub, peerHost, writeHostConfig } from "./convergence-owner-hosts.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => Promise<boolean> | boolean, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the resident.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

it(
  "keeps a non-owner resident read-only with the holder label and takes over after release",
  { timeout: 180_000 },
  async () => {
    // The Hub's clock can be moved, so the holder's lease nears its expiry without waiting.
    let skew = 0;
    const hub = new FakeConvergenceOwnerHub(() => Date.now() + skew);
    const f = await fixture(true);
    const peer = await peerHost({ sourceRoot: f.root, directory: f.directory });
    cleanups.push(async () => {
      await f.storage.close();
      await peer.storage.close();
      await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    // The fully provisioned fixture is the resident host; the clone holds the lease first.
    await writeHostConfig(peer.root, {
      hostId: `hst_${"1".repeat(32)}`,
      label: "mac",
      mode: "hub",
    });
    await writeHostConfig(f.root, { hostId: `hst_${"2".repeat(32)}`, label: "wsl", mode: "hub" });
    const ownership = (storage: typeof f.storage) =>
      new ConvergenceOwnership({ storage, provider: "claude", transport: async () => hub.port() });
    const mac = ownership(peer.storage);
    expect(await mac.observe()).toMatchObject({ role: "owner" });
    // ADR-0602: a waiting host has no timer but the holder's lease expiry, the Hub state it
    // cannot otherwise observe; two seconds of lease remain when it first looks.
    skew = CONVERGENCE_OWNER_LEASE_TTL_MS - 2_000;

    const cycles: { status: string }[] = [];
    const failures: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "wsl-resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result),
      onFailure: (error) => failures.push(error),
      intervalMilliseconds: 100,
      ownership: ownership(f.storage),
    });
    try {
      await until(() => cycles.length >= 1);
      expect(cycles[0]).toMatchObject({
        status: "waiting_owner",
        owner: { role: "waiting_owner", holder: { label: "mac" } },
        // ADR-0597: a non-owner observes no debt; only the owner scans the repository.
        convergence: { debtCounts: null, reason: "maintenance_owner_elsewhere" },
      });
      // The 100 ms loop may already be in its next cycle (`running`); wait for the waiting state.
      let health = await inspectKnowledgeResidentHealth(f.root);
      await until(async () => {
        health = await inspectKnowledgeResidentHealth(f.root);
        return health.state === "waiting";
      });
      expect(health).toMatchObject({
        status: "healthy",
        state: "waiting",
        reason: "waiting_owner:mac",
      });
      // The non-owner records no convergence obligation of its own.
      expect(
        f.storage.events
          .list({ limit: 1_000 })
          .some((event) => event.type.startsWith("repository.knowledge.")),
      ).toBe(false);

      await mac.release();
      await until(() => cycles.some((cycle) => cycle.status === "processed"), 120_000);
      expect(hub.lease).toMatchObject({ holderLabel: "wsl", generation: 2 });
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
  },
);
