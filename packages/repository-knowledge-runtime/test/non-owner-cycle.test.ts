import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import { readMaintenanceObservation } from "../src/maintenance-observation.js";
import { WAITING_OWNER_REASON } from "../src/non-owner-cycle.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const waiting: ConvergenceOwnerVerdict = {
  role: "waiting_owner",
  reason: "convergence_owner_elsewhere",
  mode: "hub",
  hostHash: `sha256:${"1".repeat(64)}`,
  hostLabel: "mac",
  holder: {
    hostHash: `sha256:${"2".repeat(64)}`,
    label: "wsl",
    generation: 3,
    expiresAt: null,
  },
  validUntil: null,
  wakeAt: null,
  grantedAt: null,
  yieldUntil: null,
  observedAt: new Date().toISOString(),
} as ConvergenceOwnerVerdict;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

it(
  "runs no scan, lint, staleness or lifecycle write on a non-owner and names the holder (ADR-0597)",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const observer = observeProcessCost();
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>>;
    try {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "non-owner",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        owner: async () => waiting,
      });
      const scopes = Object.keys(observer.snapshot().scopes);
      expect(scopes.filter((scope) => scope.split("/").includes("scan"))).toEqual([]);
      expect(scopes).not.toContain("owner_turns");
    } finally {
      observer.close();
    }
    expect(result).toMatchObject({
      status: "waiting_owner",
      owner: { holder: { label: "wsl" } },
      convergence: { debtCounts: null, reason: WAITING_OWNER_REASON },
      // Nothing is queued and no Hub transport is configured, so no owner-turn work ran.
      ownerTurns: null,
    });
    const state = resolve(f.root, ".lervo/state/knowledge");
    expect(await exists(resolve(state, "document-staleness.json"))).toBe(false);
    expect(await exists(resolve(state, "document-lifecycle.json"))).toBe(false);
    // The observation names the holder through its owner fields, with no debt of its own.
    expect(await readMaintenanceObservation(f.root, f.storage.manifest.projectId)).toMatchObject({
      source: "inspection",
      ownerGeneration: 3,
      ownerHostHash: waiting.hostHash,
      status: { debtCounts: null, reason: WAITING_OWNER_REASON },
    });
    // The non-owner records no convergence obligation of its own.
    expect(
      f.storage.events
        .list({ limit: 1_000 })
        .some((event) => event.type.startsWith("repository.knowledge.")),
    ).toBe(false);
  },
);

it("runs only the Hub exchange on a non-owner with nothing queued", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  let exchanges = 0;
  const result = await runAutonomousKnowledgeWorker({
    storage: f.storage,
    workerId: "non-owner",
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    owner: async () => waiting,
    instructionCandidateTransport: async () => {
      exchanges += 1;
      return { publish: async () => "inserted" as never, list: async () => [] };
    },
  });
  // No owner turn is queued, so capture stays idle and only the exchange runs; this fixture has
  // no Hub coordination, so the exchange keeps candidates local without opening the transport.
  expect(result).toMatchObject({
    status: "waiting_owner",
    ownerTurns: {
      instructionCapture: { status: "idle" },
      candidateExchange: { status: "standalone" },
    },
  });
  expect(exchanges).toBe(0);
});
