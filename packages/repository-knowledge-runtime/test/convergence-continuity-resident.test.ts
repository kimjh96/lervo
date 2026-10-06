import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  mergeKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { sealConvergenceContinuityPolicy } from "../src/continuity-policy.js";
import {
  ConvergenceContinuity,
  type ConvergenceHostRecordPort,
} from "../src/convergence-continuity.js";
import { ConvergenceOwnership } from "../src/convergence-owner.js";
import { CONVERGENCE_DELEGATION_PATH, loadConvergenceDelegation } from "../src/delegation.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { FakeConvergenceOwnerHub, peerHost } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const DAY = 24 * 60 * 60_000;
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
  "lets a resident on a newly added host seed its delegation and wait for the holder on its first cycle",
  { timeout: 120_000 },
  async () => {
    const mac = await fixture(true);
    const wsl = await peerHost({ sourceRoot: mac.root, directory: mac.directory });
    cleanups.push(async () => {
      await mac.storage.close();
      await wsl.storage.close();
      await rm(mac.directory, { recursive: true, force: true });
    });
    await rm(resolve(wsl.root, CONVERGENCE_DELEGATION_PATH));
    await cp(resolve(mac.root, ".lervo/verifications"), resolve(wsl.root, ".lervo/verifications"), {
      recursive: true,
    });
    const ceilings = mac.delegation!.resourceCeilings;
    const policyPath = resolve(mac.directory, "user-state/knowledge-continuity-policy.json");
    await mkdir(resolve(mac.directory, "user-state"), { recursive: true });
    await writeFile(
      policyPath,
      JSON.stringify(
        sealConvergenceContinuityPolicy({
          schemaVersion: 1,
          state: "active",
          authority: { kind: "owner_instruction", reference: "ADR-0469" },
          issuedAt: new Date(Date.now() - DAY).toISOString(),
          horizonAt: new Date(Date.now() + 300 * DAY).toISOString(),
          renewal: { termDays: 30, windowHours: 48, attentionLeadHours: 72 },
          seeding: { fromPeer: true, fromTemplate: false },
          limits: { providers: ["claude"], resourceCeilings: ceilings },
          template: null,
        }),
      ),
      { mode: 0o600 },
    );
    const records = new Map<string, KnowledgeConvergenceHostRecord>();
    const hostPort: ConvergenceHostRecordPort = {
      publish: async (record) => {
        const merged = mergeKnowledgeConvergenceHostRecord({
          current: records.get(record.hostHash) ?? null,
          incoming: structuredClone(record),
        });
        records.set(record.hostHash, merged.next);
        return merged.status;
      },
      list: async () => [...records.values()],
    };
    const hub = {
      baseUrl: "https://hub.example/",
      bearerTokenFile: "/owner-only/hub-token",
      destinationId: "hub:primary",
      hubIdentityHash: `sha256:${"a".repeat(64)}`,
    };
    const lease = new FakeConvergenceOwnerHub(Date.now);
    const continuity = (storage: typeof mac.storage, label: string) =>
      new ConvergenceContinuity({
        storage,
        policyPath,
        hubCandidates: async () => [{ source: "node_runtime", hub }],
        transport: async () => hostPort,
        publication: async () => null,
        hostLabel: label,
      });
    const ownership = (storage: typeof mac.storage) =>
      new ConvergenceOwnership({
        storage,
        provider: "claude",
        transport: async () => lease.port(),
      });

    // The existing host publishes its scope and holds the lease.
    await continuity(mac.storage, "mac").reconcile();
    expect(await ownership(mac.storage).observe()).toMatchObject({ role: "owner" });

    const cycles: { status: string; owner?: { role: string } }[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: wsl.storage,
      workerId: "wsl-resident",
      provider: "claude",
      executable: mac.executable,
      admissionDirectory: mac.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result as (typeof cycles)[number]),
      onFailure: () => undefined,
      intervalMilliseconds: 100,
      reconcileCeilingMilliseconds: 1_000,
      ownership: ownership(wsl.storage),
      continuity: continuity(wsl.storage, "wsl"),
    });
    try {
      await until(() => cycles.length >= 1);
      expect(cycles[0]).toMatchObject({
        status: "waiting_owner",
        owner: { role: "waiting_owner" },
      });
      expect((await loadConvergenceDelegation(wsl.root))?.delegation.state).toBe("active");
      expect([...records.values()].map((record) => record.hostLabel).sort()).toEqual([
        "mac",
        "wsl",
      ]);
    } finally {
      await stop();
    }
  },
);
