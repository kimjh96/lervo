import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { classifyResidentCycle } from "../src/resident-cycle.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ADR-0660: retention runs before every provider stage, so a host whose provider is unavailable
// still prunes; the resident's cadence then keeps calling such cycles while work remains.
it(
  "runs a retention pass in a cycle that waits on its provider (ADR-0660)",
  { timeout: 60_000 },
  async () => {
    const f = await fixture();
    fixtures.push(f);
    const startedAt = Date.now();
    const result = await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "waiting",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    // No provider authority is delegated, so every provider stage waits; retention needs none.
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "waiting_authority", reason: "knowledge_authority_unavailable" },
    });
    expect(classifyResidentCycle(result, Date.now())).toBe("waiting");
    const observation = JSON.parse(
      await readFile(
        resolve(f.root, ".lervo/state/knowledge/cas-retention-observation.json"),
        "utf8",
      ),
    ) as { observedAt: string };
    expect(Date.parse(observation.observedAt)).toBeGreaterThanOrEqual(startedAt);
  },
);
