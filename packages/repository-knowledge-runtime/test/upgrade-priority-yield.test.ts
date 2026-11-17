import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";
import { readMaintenanceObservation } from "../src/maintenance-observation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const pause = (milliseconds: number) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

it(
  "stops a running cycle before its next stage for an upgrade that then goes ahead of waiting residents (ADR-0574)",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const stages = () =>
      f.events
        .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
        .filter((event) => event.payload.state !== "queued").length;
    const signal = new AbortController().signal;
    const worker = (admission?: Awaited<ReturnType<typeof acquireFullCycleAdmission>>) =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "resident",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        ...(admission === undefined
          ? {}
          : {
              shouldYield: () => admission.contended(),
              yieldToUpgrade: () => admission.preempted(),
            }),
      });
    // This repository's resident holds the host's full-cycle admission, as `runFull` does.
    const cycle = await acquireFullCycleAdmission({
      repositoryRoot: f.root,
      signal,
      directory: f.admissionDirectory,
    });
    const order: string[] = [];
    const queue = (name: string, repositoryRoot: string, priority: "resident" | "upgrade") =>
      acquireFullCycleAdmission({
        repositoryRoot,
        signal,
        directory: f.admissionDirectory,
        pollMilliseconds: 10,
        priority,
      }).then(async (held) => {
        order.push(name);
        await held.release();
      });
    const resident = queue("resident", resolve(f.directory, "another-repository"), "resident");
    await pause(50);
    const upgrade = queue("upgrade", f.root, "upgrade");
    await pause(50);

    const yielded = await worker(cycle);
    await cycle.release();
    await Promise.all([resident, upgrade]);

    // No convergence stage ran: the upgrade did not wait for the cycle's work to finish.
    expect(yielded).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
    expect(stages()).toBe(0);
    expect(order).toEqual(["upgrade", "resident"]);

    // The work the cycle left stays due, and the next cycle runs it.
    const next = await worker();
    expect(next.status).toBe("processed");
    expect(stages()).toBeGreaterThan(0);
  },
);

it(
  "finishes the convergence stage in progress when an upgrade arrives during it, then stops (ADR-0574)",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const stages = () =>
      f.events
        .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
        .filter((event) => event.payload.state !== "queued").length;
    // The upgrade starts waiting once the first convergence stage has run; until then no
    // boundary sees it. A waiting upgrade is also a contending waiter.
    let upgradeWaiting = false;
    const waiting = async () => (upgradeWaiting ||= stages() > 0);
    let boundariesBeforeConvergence = 0;
    const result = await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      shouldYield: waiting,
      yieldToUpgrade: async () => {
        if (stages() === 0) boundariesBeforeConvergence += 1;
        return waiting();
      },
    });
    expect(boundariesBeforeConvergence).toBeGreaterThan(0);
    expect(stages()).toBe(1);
    expect(result).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
  },
);

it(
  "stops a non-owner's read-only cycle at its next boundary for a waiting upgrade (ADR-0574)",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const verdict: ConvergenceOwnerVerdict = {
      role: "waiting_owner",
      reason: "convergence_owner_elsewhere",
      mode: "hub",
      hostHash: null,
      hostLabel: null,
      holder: null,
      validUntil: null,
      wakeAt: null,
      grantedAt: null,
      yieldUntil: null,
      observedAt: new Date().toISOString(),
    };
    const run = (yieldToUpgrade: () => Promise<boolean>) =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "resident",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        owner: async () => verdict,
        yieldToUpgrade,
      });
    // The upgrade arrives after owner-turn capture, before retention and debt inspection.
    let asked = 0;
    const yielded = await run(async () => ++asked > 1);
    expect(asked).toBe(2);
    expect(yielded).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
    expect(await readMaintenanceObservation(f.root, f.storage.manifest.projectId)).toBeNull();

    const inspected = await run(async () => false);
    expect(inspected.status).toBe("waiting_owner");
    expect(await readMaintenanceObservation(f.root, f.storage.manifest.projectId)).toMatchObject({
      source: "inspection",
    });
  },
);

/**
 * Runs one owner cycle whose upgrade starts waiting once `after` has finished, and reports which
 * cost scopes ran. Scopes settle when a stage returns, so the first boundary after `after` sees it.
 */
async function yieldAfterStage(after: string) {
  const f = await fixture(true);
  fixtures.push(f);
  const observer = observeProcessCost();
  let ownerRulesApplied = false;
  try {
    const result = await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      applyOwnerStatedInstructions: async () => {
        ownerRulesApplied = true;
      },
      yieldToUpgrade: async () => observer.snapshot().scopes[after] !== undefined,
    });
    return { result, scopes: observer.snapshot().scopes, ownerRulesApplied };
  } finally {
    observer.close();
  }
}

it(
  "checks for a waiting upgrade between retention and owner-turn capture (ADR-0574)",
  { timeout: 120_000 },
  async () => {
    const { result, scopes } = await yieldAfterStage("retention");
    expect(result).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
    expect(scopes.retention).toBeDefined();
    expect(scopes.owner_turns).toBeUndefined();
  },
);

it(
  "checks for a waiting upgrade between owner-turn capture and owner-rule application (ADR-0574)",
  { timeout: 120_000 },
  async () => {
    const { result, scopes, ownerRulesApplied } = await yieldAfterStage("owner_turns");
    expect(result).toEqual({ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" });
    expect(scopes.owner_turns).toBeDefined();
    expect(scopes.owner_rules).toBeUndefined();
    expect(ownerRulesApplied).toBe(false);
  },
);
