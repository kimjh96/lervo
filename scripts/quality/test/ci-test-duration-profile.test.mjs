import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import {
  CI_TEST_DURATION_PROFILE_LIMIT,
  createCiTestDurationProfile,
  createCiTestWeightProfile,
  parseVitestModuleDurations,
  readCiTestDurationProfile,
} from "../lib/ci-test-duration-profile.mjs";
import { CI_TEST_LEDGER_CONTRACT } from "../lib/ci-test-ledger.mjs";
import { readCiTestLedgerRun } from "../lib/ci-test-ledger-runs.mjs";

const escape = String.fromCharCode(27);

it("reads per-file durations from raw and gh-sanitized Vitest shard logs", () => {
  const prefix = "Tests (shard 4/4)\tUNKNOWN STEP\t2026-11-14T09:23:37.9072455Z  ";
  const log = [
    // `gh run view --log` turns the escape byte into a literal `^[`.
    `${prefix}^[[32m✓^[[39m packages/repository-knowledge-runtime/test/worker.test.ts ^[[2m(^[[22m^[[2m9 tests^[[22m^[[2m)^[[22m^[[33m 179568^[[2mms^[[22m^[[39m`,
    ` ${escape}[32m✓${escape}[39m apps/cli/test/cli.test.ts ${escape}[2m(${escape}[22m${escape}[2m1 test${escape}[22m${escape}[2m)${escape}[22m 512${escape}[2mms${escape}[22m`,
    " × scripts/quality/test/failing.test.mjs (4 tests | 1 failed | 2 skipped) 3400ms 48 MB heap used",
    " ✓ apps/cli/test/cli.test.ts (1 test) 300ms",
    // Skipped files print no duration, and slow-test lines are not module summaries.
    " ↓ apps/node-runtime/test/live.test.ts (2 tests | 2 skipped)",
    "   ✓ apps/cli/test/cli.test.ts > runs a slow case 6000ms",
    " ✓ fixtures/outside.test.ts (1 test) 10ms",
  ].join("\r\n");
  expect(Object.fromEntries(parseVitestModuleDurations(log))).toEqual({
    "packages/repository-knowledge-runtime/test/worker.test.ts": 179568,
    "apps/cli/test/cli.test.ts": 512,
    "scripts/quality/test/failing.test.mjs": 3400,
  });
});

it("keeps only the slowest files, sorted by path, with the run that measured them", () => {
  const durations = new Map([
    ["b.test.ts", 3000.4],
    ["a.test.ts", 1000],
    ["c.test.ts", 2000],
    ["zero.test.ts", 0],
  ]);
  const source = { runId: "42", revision: "a".repeat(40), observedAt: "2026-11-14" };
  const profile = createCiTestDurationProfile({ durations, source, limit: 2 });
  expect(profile).toEqual({
    schemaVersion: 1,
    sourceRunId: "42",
    sourceRevision: "a".repeat(40),
    observedAt: "2026-11-14",
    maximumEntries: 2,
    durations: { "b.test.ts": 3000, "c.test.ts": 2000 },
  });
  expect(Object.keys(profile.durations)).toEqual(["b.test.ts", "c.test.ts"]);
  const many = new Map(Array.from({ length: 500 }, (_, i) => [`f${i}.test.ts`, i + 1]));
  expect(
    Object.keys(createCiTestDurationProfile({ durations: many, source }).durations),
  ).toHaveLength(CI_TEST_DURATION_PROFILE_LIMIT);
});

it("accepts the committed profile and rejects profiles the planner must not trust", async () => {
  const committed = JSON.parse(
    await readFile(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
  );
  const { weights, defaultWeight } = readCiTestDurationProfile(committed);
  expect(Object.keys(weights).length).toBeGreaterThan(0);
  expect(defaultWeight).toBeGreaterThan(0);
  // A version 1 profile keeps its planner meaning: test time plus a 1.5-second overhead.
  expect(readCiTestDurationProfile({ schemaVersion: 1, durations: { "a.test.ts": 10 } })).toEqual({
    weights: { "a.test.ts": 1510 },
    defaultWeight: 1500,
  });
  const oversized = Object.fromEntries(
    Array.from({ length: CI_TEST_DURATION_PROFILE_LIMIT + 1 }, (_, i) => [`f${i}.test.ts`, 1]),
  );
  for (const profile of [
    null,
    { schemaVersion: 2, durations: {} },
    { schemaVersion: 2, weights: {} },
    { schemaVersion: 2, weights: { "a.test.ts": -1 }, defaultWeight: 1 },
    { schemaVersion: 3, weights: {}, defaultWeight: 1 },
    { schemaVersion: 1 },
    { schemaVersion: 1, durations: oversized },
    { schemaVersion: 1, durations: { "a.test.ts": -1 } },
    { schemaVersion: 1, durations: { "a.test.ts": "1" } },
    { schemaVersion: 1, durations: { "a.test.ts": 600_001 } },
  ])
    expect(() => readCiTestDurationProfile(profile)).toThrow("ci_duration_profile_invalid");
});

it("weighs each file by its median over the newest ledger runs", () => {
  const run = (runId, entries, complete = true) => ({
    runId,
    revision: runId.padStart(40, "0"),
    complete,
    weights: new Map(Object.entries(entries)),
  });
  const current = { weights: { "gone.test.ts": 9000, "kept.test.ts": 8000 }, defaultWeight: 1500 };
  const runs = [
    run("1", { "a.test.ts": 900_000, "b.test.ts": 1 }),
    run("4", { "a.test.ts": 4000, "b.test.ts": 3000, "c.test.ts": 10 }),
    run("3", { "a.test.ts": 6000, "b.test.ts": 1000, "c.test.ts": 30 }),
    run("2", { "a.test.ts": 5000, "c.test.ts": 20 }),
  ];
  const profile = createCiTestWeightProfile({
    runs,
    current,
    window: 3,
    limit: 2,
    observedAt: "2026-11-14",
  });
  // Run 1 is outside the window, so its outlier never counts.
  expect(profile).toEqual({
    schemaVersion: 2,
    statistic: "median",
    window: 3,
    sources: ["4", "3", "2"].map((runId) => ({ runId, revision: runId.padStart(40, "0") })),
    observedAt: "2026-11-14",
    maximumEntries: 2,
    defaultWeight: 20,
    weights: { "a.test.ts": 5000, "b.test.ts": 2000 },
  });
  expect(readCiTestDurationProfile(profile).defaultWeight).toBe(20);
  // A file no complete run measured is gone; with a shard missing, it keeps its current weight.
  const partial = createCiTestWeightProfile({
    runs: [run("5", { "a.test.ts": 100 }, false)],
    current,
    limit: 3,
    observedAt: "2026-11-14",
  });
  expect(partial.weights).toEqual({
    "a.test.ts": 100,
    "gone.test.ts": 9000,
    "kept.test.ts": 8000,
  });
  expect(partial.defaultWeight).toBe(1500);
  expect(() => createCiTestWeightProfile({ runs: [], current, observedAt: "2026-11-14" })).toThrow(
    "ci_duration_ledgers_empty",
  );
});

it("reads a downloaded run's shard ledgers and reports whether every shard is present", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-ci-ledger-run-"));
  const ledger = (index, files, id = "77") => ({
    schemaVersion: 1,
    contract: CI_TEST_LEDGER_CONTRACT,
    run: { id, revision: "b".repeat(40), shard: { index, count: 2 } },
    files,
  });
  const write = async (path, value) => {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), JSON.stringify(value));
  };
  try {
    await write(
      "run/lervo-ci-test-ledger-1/ledger-shard-1-of-2.json",
      ledger(1, [
        { file: "a.test.ts", result: "passed", durationMs: 10, collectMs: 5 },
        { file: "skipped.test.ts", result: "skipped", durationMs: 0, collectMs: 3 },
      ]),
    );
    const partial = await readCiTestLedgerRun(resolve(root, "run"));
    expect(partial).toMatchObject({ runId: "77", complete: false });
    expect(Object.fromEntries(partial.weights)).toEqual({ "a.test.ts": 15 });
    await write(
      "run/lervo-ci-test-ledger-2/ledger-shard-2-of-2.json",
      ledger(2, [{ file: "b.test.ts", result: "failed", durationMs: 7, collectMs: 1 }]),
    );
    const complete = await readCiTestLedgerRun(resolve(root, "run"));
    expect(complete.complete).toBe(true);
    expect(Object.fromEntries(complete.weights)).toEqual({ "a.test.ts": 15, "b.test.ts": 8 });
    await write("other/ledger-shard-1-of-2.json", ledger(1, [], "77"));
    await write("other/x/ledger-shard-2-of-2.json", ledger(2, [], "78"));
    await expect(readCiTestLedgerRun(resolve(root, "other"))).rejects.toThrow(
      "ci_duration_source_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
