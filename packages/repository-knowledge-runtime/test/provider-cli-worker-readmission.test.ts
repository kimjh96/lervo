import { readFile, writeFile, rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "./fixture.js";
import { isolateProviderCliDetection } from "./provider-cli-detection-isolation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

// Three full worker runs spawn roughly 550 git processes plus the fixture provider; like every
// other full-worker test here, this needs more than the 5 s default on slower process spawners.
it(
  "waits through the real resolver and host, then readmits the waiting stage after executable replacement",
  {
    timeout: 120_000,
  },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    isolateProviderCliDetection(f.directory);
    const original = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      original.replace("stop_reason:'end_turn',num_turns:1", "stop_reason:'tool_use',num_turns:2"),
    );
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "admission-regression",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
        liveWorkPending: async () => false,
      });
    expect(await run()).toMatchObject({
      status: "processed",
      convergence: { state: "waiting_authority", reason: "provider_not_admitted" },
    });
    expect(await run()).toMatchObject({
      status: "processed",
      convergence: { state: "waiting_authority", reason: "provider_not_admitted" },
    });
    await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(f.executable, original);
    const result = await run();
    expect(result.status).toBe("processed");
    if (result.status === "processed")
      expect(result.convergence.reason).not.toBe("provider_not_admitted");
    expect(f.events.list({ limit: 1000, types: ["provider.cli.admitted"] })).toHaveLength(1);
    expect(await readFile(f.log, "utf8")).toContain("request");
  },
);
