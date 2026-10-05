import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

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
    const hub = new FakeConvergenceOwnerHub(Date.now);
    const f = await fixture(true);
    const peer = await peerHost({ sourceRoot: f.root, directory: f.directory });
    cleanups.push(async () => {
      await f.storage.close();
      await peer.storage.close();
      await rm(f.directory, { recursive: true, force: true });
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
      reconcileCeilingMilliseconds: 1_000,
      ownership: ownership(f.storage),
    });
    try {
      await until(() => cycles.length >= 1);
      expect(cycles[0]).toMatchObject({
        status: "waiting_owner",
        owner: { role: "waiting_owner", holder: { label: "mac" } },
        convergence: { debtCounts: expect.any(Object) },
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
