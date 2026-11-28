import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { CAS_RETENTION_HOST_PAUSE_MILLISECONDS as PAUSE } from "../src/cas-retention-host-turns.js";
import * as files from "../src/cas-retention-files.js";
import { runCasRetentionSlice } from "../src/cas-retention-slice.js";
import { retentionFixture } from "./cas-retention-fixture.js";

// ADR-0660: slices under the host's retention turns, with a read budget small enough to observe.
vi.mock("../src/cas-retention-budget.js", async (original) => ({
  ...(await original<typeof import("../src/cas-retention-budget.js")>()),
  REFERENCE_SCAN_LIMITS: { maximumReads: 1_024, maximumBytes: 1024 * 1024, maximumWorkMs: 4_000 },
}));

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const dispose of cleanup.splice(0)) await dispose();
});

async function host() {
  const f = await retentionFixture();
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-retention-host-"));
  cleanup.push(f.dispose, () => rm(directory, { recursive: true, force: true }));
  // Observations stamp `new Date()`, so the whole Date is faked.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-28T12:00:00.000Z") });
  const slice = () =>
    runCasRetentionSlice({ storage: f.storage, directory, shouldYield: async () => false });
  const observation = async () =>
    JSON.parse(
      await readFile(
        resolve(f.storage.paths.knowledgeState, files.CAS_RETENTION_OBSERVATION),
        "utf8",
      ),
    ) as Record<string, unknown>;
  return { f, slice, observation };
}

it("removes every candidate across paced slices while each one leaves work", async () => {
  const { f, slice } = await host();
  const remove = files.removeUnreachableCasObject;
  // A slow disk: each removal takes a second, so one slice removes its minimum of 32.
  vi.spyOn(files, "removeUnreachableCasObject").mockImplementation(async (...args) => {
    vi.setSystemTime(Date.now() + 1_000);
    return remove(...args);
  });
  const artifacts = [];
  for (let index = 0; index < 40; index++) artifacts.push(await f.put({ index }));
  await f.settled(
    "paced",
    artifacts.map((artifact) => artifact.contentHash),
  );
  const removed: number[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await slice();
    if (result.outcome === "deferred") {
      vi.setSystemTime(result.retryAt!);
      continue;
    }
    expect(result.outcome).toBe("ran");
    removed.push(result.observation!.removedObjects);
    if (result.observation!.remaining !== true) break;
    // The next request comes before the host's pause has passed, and is deferred to its end.
    vi.setSystemTime(Date.now() + 1_000);
  }
  expect(removed).toEqual([32, 9]);
});

it("counts a file that changes faster than a slice reads it as a stall, and names it", async () => {
  const { f, slice, observation } = await host();
  await f.settled("stalled");
  const state = resolve(f.storage.paths.knowledgeState, "churn");
  await mkdir(state, { recursive: true });
  const churning = resolve(state, "large.json");
  const stalls: unknown[] = [];
  for (let pass = 0; pass < 6; pass++) {
    // Rewritten between slices: each slice restarts it, and three MiB never fit one MiB.
    await writeFile(churning, `${pass}`.padEnd(3 * 1024 * 1024, "x"));
    await slice();
    const recorded = await observation();
    stalls.push([recorded.stalledPasses, recorded.remaining]);
    vi.setSystemTime(Date.now() + PAUSE);
  }
  // The first slice read the new file partway, which is progress; every later one restarted it.
  expect(stalls).toEqual([
    [undefined, true],
    [1, true],
    [2, true],
    [3, true],
    [4, true],
    [5, false],
  ]);
  expect(await observation()).toMatchObject({
    stallCause: "read_budget_exhausted",
    stallReference: ".lervo/state/knowledge/churn/large.json",
  });
});

it("resumes a large unchanged file across slices without a stall", async () => {
  const { f, slice, observation } = await host();
  const { obsolete } = await f.settled("resumed");
  const state = resolve(f.storage.paths.knowledgeState, "steady");
  await mkdir(state, { recursive: true });
  await writeFile(resolve(state, "large.json"), "x".repeat(3 * 1024 * 1024));
  for (let pass = 0; pass < 8; pass++) {
    const result = await slice();
    vi.setSystemTime(Date.now() + PAUSE);
    if (result.outcome === "ran" && result.observation!.remaining !== true) break;
  }
  expect(await observation()).toMatchObject({ status: "collected", remaining: false });
  expect(await observation()).not.toHaveProperty("stalledPasses");
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
});

it("lets a slice that reads further end any stall, even one at its bound", async () => {
  const { f, slice, observation } = await host();
  await f.settled("carried");
  const state = resolve(f.storage.paths.knowledgeState, "steady");
  await mkdir(state, { recursive: true });
  await writeFile(resolve(state, "large.json"), "x".repeat(3 * 1024 * 1024));
  await writeFile(
    resolve(f.storage.paths.knowledgeState, files.CAS_RETENTION_OBSERVATION),
    JSON.stringify({
      observedAt: new Date().toISOString(),
      stalledPasses: 5,
      stallCause: "inventory_changed",
    }),
  );
  await slice();
  const recorded = await observation();
  expect(recorded).toMatchObject({ remaining: true });
  expect(recorded).not.toHaveProperty("stalledPasses");
});
