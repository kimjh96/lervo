import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { fixture } from "./fixture.js";
import { FakeConvergenceOwnerHub, peerHost, writeHostConfig } from "./convergence-owner-hosts.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => Promise<boolean> | boolean, timeout: number) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the resident.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

it(
  "runs a full owner cycle as soon as the same loop turns from non-owner to owner (ADR-0599)",
  { timeout: 180_000 },
  async () => {
    const hub = new FakeConvergenceOwnerHub(Date.now);
    const f = await fixture(true);
    const peer = await peerHost({ sourceRoot: f.root, directory: f.directory });
    cleanups.push(async () => {
      await f.storage.close();
      await peer.storage.close();
      await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
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

    // Cycle results are a union per status; the test reads only `status` and `owner.role`.
    const cycles: Record<string, unknown>[] = [];
    const failures: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "wsl-takeover",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result as unknown as Record<string, unknown>),
      onFailure: (error) => failures.push(error),
      intervalMilliseconds: 100,
      reconcileCeilingMilliseconds: 1_000,
      ownership: ownership(f.storage),
    });
    try {
      // The non-owner cycle fences on the Git-free digest and reports the holder.
      await until(() => cycles.length >= 1, 60_000);
      expect(cycles[0]).toMatchObject({
        status: "waiting_owner",
        owner: { role: "waiting_owner" },
      });
      await mac.release();
      // The next observation takes the lease; the role and the full digest both move the fence.
      await until(() => hub.lease?.holderLabel === "wsl", 15_000);
      const before = cycles.length;
      await until(() => cycles.length > before, 120_000);
      // The first cycle after the takeover is the owner's own full cycle, not another wait.
      expect(cycles[before]).toMatchObject({ owner: { role: "owner" } });
      expect(cycles[before]!.status).not.toBe("waiting_owner");
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
  },
);
