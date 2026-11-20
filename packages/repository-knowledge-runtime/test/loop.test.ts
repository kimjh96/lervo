import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProcessCostMeasurement } from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";
import { appendFreshnessEvent } from "../src/freshness-events.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { readResidentCycleState } from "../src/resident-cycle-state.js";
import { inspectKnowledgeResidentHealth } from "../src/resident-health.js";
import { clearOfFenceTimeWindowBoundary, fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function until(condition: () => Promise<boolean> | boolean, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for the resident.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

it(
  "keeps reconciling continuity while a cycle waits for host-wide admission (ADR-0470)",
  { timeout: 60_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    const held = await acquireFullCycleAdmission({
      repositoryRoot: resolve(f.directory, "another-repository"),
      signal: new AbortController().signal,
      directory: f.admissionDirectory,
    });
    let reconciliations = 0;
    const cycles: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result),
      onFailure: () => undefined,
      intervalMilliseconds: 100,
      // Continuity names its own next due time; ADR-0602 offers it a turn exactly then.
      continuity: {
        inputPaths: () => [],
        reconcile: async () => {
          reconciliations += 1;
          return { nextReconcileAt: new Date(Date.now() + 50).toISOString() };
        },
      } as never,
    });
    try {
      await until(() => reconciliations >= 4);
      expect(cycles).toEqual([]);
    } finally {
      await held.release();
      await stop();
    }
  },
);

it(
  "stays asleep while only its own outcome records are appended and wakes for an edit (ADR-0598, ADR-0602)",
  { timeout: 120_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    await clearOfFenceTimeWindowBoundary();
    const cycles: unknown[] = [];
    const failures: unknown[] = [];
    // No `subscribe`: the resident's own event and repository watches are the wakeups under test.
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      onCycle: (result) => cycles.push(result),
      onFailure: (error) => failures.push(error),
      intervalMilliseconds: 100,
      wakeDebounceMilliseconds: 200,
    });
    const state = async () => JSON.stringify(await readResidentCycleState(f.root));
    try {
      // The first cycle records the waiting obligation; the second confirms its own events settled.
      await until(() => cycles.length >= 2);
      // Settled: nothing wakes the resident, so its recorded state stops changing.
      let settledState = await state();
      await until(async () => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
        const next = await state();
        const same = next === settledState;
        settledState = next;
        return same;
      });
      const settled = cycles.length;
      // Asleep, the resident arms no timer at all: nothing is polled or re-armed.
      const wait = setTimeout;
      const timeouts = vi.spyOn(globalThis, "setTimeout");
      const intervals = vi.spyOn(globalThis, "setInterval");
      try {
        await new Promise((resolveDelay) => wait(resolveDelay, 3_000));
        expect(timeouts).not.toHaveBeenCalled();
        expect(intervals).not.toHaveBeenCalled();
      } finally {
        timeouts.mockRestore();
        intervals.mockRestore();
      }
      // The records an idle owner appended every two minutes on 2026-11-20.
      for (let index = 0; index < 3; index++) {
        const at = new Date().toISOString();
        appendFreshnessEvent({
          storage: f.storage,
          type: "document.freshness.cycle.completed",
          correlationId: `kfcy_${String(index).padStart(24, "0")}`,
          coordinate: null,
          occurredAt: at,
          payload: {
            cycleId: `kfcy_${String(index).padStart(24, "0")}`,
            findingCount: 7,
            admittedCount: 0,
            candidateCount: 0,
            verifiedCount: 0,
            appliedCount: 0,
            skippedForBudget: 1,
            skippedForHold: 2,
            usageObserved: 0,
            occurredAt: at,
          },
        });
      }
      // Each append pinged the resident synchronously, and its debounce is 200 ms: had any of
      // them woken it, the observation would have rewritten its cycle state by now.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
      expect(cycles).toHaveLength(settled);
      expect(await state()).toBe(settledState);
      // A foreign change runs the resident in full, through its own repository watch.
      await writeFile(resolve(f.root, "README.md"), "# Repository\n\nEdited.\n");
      await until(() => cycles.length > settled);
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
  },
);

it(
  "skips unchanged reconciliation, keeps the waiting reason, and runs in full after an edit",
  { timeout: 120_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    // A 30-minute fence window boundary before the idle check would run one more full cycle.
    await clearOfFenceTimeWindowBoundary();
    const cycles: unknown[] = [];
    const costs: ProcessCostMeasurement[] = [];
    const failures: unknown[] = [];
    let wake: () => void = () => undefined;
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      // Wakeups arrive only when the test signals one, as a change hint would.
      subscribe: (next) => {
        wake = next;
        return () => undefined;
      },
      onCycle: (result, cost) => {
        cycles.push(result);
        costs.push(cost);
      },
      onFailure: (error) => failures.push(error),
      intervalMilliseconds: 100,
      wakeDebounceMilliseconds: 50,
    });
    try {
      // The first cycle records the waiting obligation. Its events change the fence, and the
      // event watch this stub replaces would wake the resident for them: the test delivers it.
      await until(() => cycles.length >= 1);
      wake();
      // The second full cycle confirms its own events settled.
      await until(() => cycles.length >= 2);
      const settled = cycles.length;
      // Hints that change nothing observe the fence and skip the full cycle every time.
      const observedAt = async () => (await readResidentCycleState(f.root))?.lastObservedAt;
      for (let hint = 0; hint < 4; hint += 1) {
        const before = await observedAt();
        wake();
        await until(async () => (await observedAt()) !== before);
        expect(await readResidentCycleState(f.root)).toMatchObject({ idleStreak: 1 });
      }
      expect(cycles).toHaveLength(settled);
      expect(await readResidentCycleState(f.root)).toMatchObject({
        lastResult: "waiting",
        fingerprint: expect.stringMatching(/^sha256:/u),
      });
      expect(await inspectKnowledgeResidentHealth(f.root)).toMatchObject({
        state: "waiting",
        reason: "knowledge_authority_unavailable",
      });
      await writeFile(resolve(f.root, "README.md"), "# Repository\n\nEdited.\n");
      wake();
      await until(() => cycles.length > settled);
      expect(failures).toEqual([]);
      // Each completed cycle reports its own Git processes by scope, with no path or argument.
      expect(costs.some((cost) => cost.scopes.convergence?.calls === 1)).toBe(true);
      for (const cost of costs) {
        expect(cost.scopes.fingerprint!.gitProcesses).toEqual({ "rev-parse": 1, status: 1 });
        expect(cost.gitProcesses).toBe(
          Object.values(cost.scopes)
            .flatMap((scope) => Object.values(scope.gitProcesses))
            .reduce((sum, count) => sum + count, 0),
        );
        expect(cost.wallMilliseconds).toBeGreaterThan(0);
        expect(JSON.stringify(cost)).not.toContain(f.root);
      }
    } finally {
      await stop();
    }
    expect(await inspectKnowledgeResidentHealth(f.root)).toMatchObject({ status: "not_running" });
  },
);

it(
  "keeps a waiting resident behind an upgrade that asked later, then runs its cycle (ADR-0574)",
  { timeout: 60_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    const signal = new AbortController().signal;
    const held = await acquireFullCycleAdmission({
      repositoryRoot: resolve(f.directory, "another-repository"),
      signal,
      directory: f.admissionDirectory,
    });
    const cycles: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result),
      onFailure: () => undefined,
      intervalMilliseconds: 100,
    });
    try {
      await until(
        async () =>
          (await inspectKnowledgeResidentHealth(f.root)).reason ===
          "knowledge_cycle_admission_wait",
      );
      const upgrade = acquireFullCycleAdmission({
        repositoryRoot: f.root,
        signal,
        directory: f.admissionDirectory,
        pollMilliseconds: 10,
        priority: "upgrade",
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      await held.release();
      const admitted = await upgrade;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      expect(cycles).toEqual([]);
      await admitted.release();
      await until(() => cycles.length >= 1);
    } finally {
      await held.release();
      await stop();
    }
  },
);
