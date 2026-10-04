import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { readResidentCycleState } from "../src/resident-cycle-state.js";
import { inspectKnowledgeResidentHealth } from "../src/resident-health.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
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
  "skips unchanged reconciliation, keeps the waiting reason, and runs in full after an edit",
  { timeout: 120_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    const cycles: unknown[] = [];
    const failures: unknown[] = [];
    const stop = startAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "resident",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      subscribe: () => () => undefined,
      onCycle: (result) => cycles.push(result),
      onFailure: (error) => failures.push(error),
      intervalMilliseconds: 100,
      reconcileCeilingMilliseconds: 5_000,
    });
    try {
      // The first cycle records the waiting obligation; the second confirms its own events settled.
      await until(() => cycles.length >= 2);
      const settled = cycles.length;
      await until(async () => ((await readResidentCycleState(f.root))?.idleStreak ?? 0) >= 4);
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
      await until(() => cycles.length > settled);
      expect(failures).toEqual([]);
    } finally {
      await stop();
    }
    expect(await inspectKnowledgeResidentHealth(f.root)).toMatchObject({ status: "not_running" });
  },
);
