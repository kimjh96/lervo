import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import { CONVERGENCE_OWNER_LEASE_TTL_MS } from "../src/convergence-owner-verdict.js";

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
    // ADR-0602: without a Hub change wait (a holder that vanished without releasing), a waiting
    // host's one timer is the holder's lease expiry; two seconds remain when it first looks.
    skew = CONVERGENCE_OWNER_LEASE_TTL_MS - 2_000;

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
      // The first cycle after the takeover is the owner's own full cycle, not another wait: it
      // inspects convergence, which only an owner does (ADR-0597).
      expect(cycles[before]!.status).not.toBe("waiting_owner");
      expect(cycles[before]).toHaveProperty("convergence.transport", "ready");
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
  },
);

it.each([
  ["the whole lease", 0],
  ["twenty seconds", CONVERGENCE_OWNER_LEASE_TTL_MS - 20_000],
])(
  "takes over at once when the holder releases with %s left, with no clock skew (ADR-0602)",
  { timeout: 180_000 },
  async (_left, elapsed) => {
    // The holder's lease is `elapsed` old by the Hub's clock, which is the hosts' clock too.
    const hub = new FakeConvergenceOwnerHub(() => Date.now());
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
    if (elapsed > 0) {
      const acquired = Date.now() - elapsed;
      hub.lease = {
        ...hub.lease!,
        acquiredAt: new Date(acquired).toISOString(),
        renewedAt: new Date(acquired).toISOString(),
        expiresAt: new Date(acquired + CONVERGENCE_OWNER_LEASE_TTL_MS).toISOString(),
      };
    }
    const cycles: Record<string, unknown>[] = [];
    const failures: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "wsl-push-takeover",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result as unknown as Record<string, unknown>),
      onFailure: (error) => failures.push(error),
      ownership: ownership(f.storage),
      hubChanges: hub.changes(),
    });
    try {
      await until(() => cycles.length >= 1, 60_000);
      expect(cycles[0]).toMatchObject({ status: "waiting_owner" });
      const released = Date.now();
      await mac.release();
      // The release wakes the waiting host through its Hub change wait. The bound is generous for
      // a loaded host, yet below the time the expiry alone would take (the lease plus its grace).
      const bound = elapsed === 0 ? 60_000 : 15_000;
      await until(() => hub.lease?.holderLabel === "wsl", bound);
      expect(Date.now() - released).toBeLessThan(bound);
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
  },
);
