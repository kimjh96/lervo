import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import {
  CI_TEST_DURATION_PROFILE_LIMIT,
  createCiTestDurationProfile,
  parseVitestModuleDurations,
  readCiTestDurationProfile,
} from "../lib/ci-test-duration-profile.mjs";

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
  expect(Object.keys(readCiTestDurationProfile(committed)).length).toBeGreaterThan(0);
  const oversized = Object.fromEntries(
    Array.from({ length: CI_TEST_DURATION_PROFILE_LIMIT + 1 }, (_, i) => [`f${i}.test.ts`, 1]),
  );
  for (const profile of [
    null,
    { schemaVersion: 2, durations: {} },
    { schemaVersion: 1 },
    { schemaVersion: 1, durations: oversized },
    { schemaVersion: 1, durations: { "a.test.ts": -1 } },
    { schemaVersion: 1, durations: { "a.test.ts": "1" } },
    { schemaVersion: 1, durations: { "a.test.ts": 600_001 } },
  ])
    expect(() => readCiTestDurationProfile(profile)).toThrow("ci_duration_profile_invalid");
});
