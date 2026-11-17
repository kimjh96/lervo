import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";
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
