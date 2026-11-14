import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { readCiTestDurationProfile } from "../lib/ci-test-duration-profile.mjs";
import CiTestSequencer from "../lib/ci-test-sequencer.mjs";
import { assignCiTestShards } from "../lib/ci-test-shards.mjs";

const legacy = (durations) => readCiTestDurationProfile({ schemaVersion: 1, durations });

it("balances heavy files while covering every known or new file exactly once", () => {
  const files = Array.from({ length: 200 }, (_, i) => ({ id: `test-${i}`, path: `tests/${i}.ts` }));
  const durations = { "tests/0.ts": 100_000, "tests/1.ts": 80_000, "tests/2.ts": 60_000 };
  const groups = assignCiTestShards(files, legacy(durations), 4);
  expect(groups.flat().toSorted()).toEqual(files.map((file) => file.id).toSorted());
  expect(groups).toEqual(assignCiTestShards(files.toReversed(), legacy(durations), 4));
  expect(
    groups.filter(
      (group) => group.includes("test-0") || group.includes("test-1") || group.includes("test-2"),
    ),
  ).toHaveLength(3);
  const weights = groups.map((group) =>
    group.reduce(
      (sum, id) => sum + 1500 + (durations[files.find((file) => file.id === id).path] ?? 0),
      0,
    ),
  );
  expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(1500);
});

it("rejects duplicate tests, invalid weights and invalid shard coordinates", () => {
  const file = { id: "one", path: "one.ts" };
  const empty = { weights: {}, defaultWeight: 1500 };
  expect(() => assignCiTestShards([file, file], empty, 4)).toThrow("ci_test_identity_duplicate");
  for (const count of [0, 17, 1.5])
    expect(() => assignCiTestShards([file], empty, count)).toThrow("ci_shard_coordinates_invalid");
  for (const profile of [
    { weights: { "one.ts": -1 }, defaultWeight: 1500 },
    { weights: {}, defaultWeight: Number.NaN },
  ])
    expect(() => assignCiTestShards([file], profile, 4)).toThrow("ci_test_duration_invalid");
});

it("balances the committed profile with new files to within one default weight", async () => {
  const profile = JSON.parse(
    await readFile(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
  );
  const { weights, defaultWeight } = readCiTestDurationProfile(profile);
  const paths = [
    ...Object.keys(weights),
    ...Array.from({ length: 1150 }, (_, i) => `packages/new/test/file-${i}.test.ts`),
  ];
  const groups = assignCiTestShards(
    paths.map((path) => ({ id: path, path })),
    { weights, defaultWeight },
    4,
  );
  expect(groups.flat().toSorted()).toEqual(paths.toSorted());
  const totals = groups.map((group) =>
    group.reduce((sum, path) => sum + (weights[path] ?? defaultWeight), 0),
  );
  expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(defaultWeight);
});

it("weighs ledger profiles by test plus collection time and assigns every file once", () => {
  const files = Array.from({ length: 300 }, (_, i) => ({ id: `f${i}`, path: `tests/${i}.ts` }));
  const profile = readCiTestDurationProfile({
    schemaVersion: 2,
    defaultWeight: 2100,
    weights: { "tests/0.ts": 90_000, "tests/1.ts": 45_000, "tests/2.ts": 44_000 },
  });
  const groups = assignCiTestShards(files, profile, 4);
  expect(groups.flat().toSorted()).toEqual(files.map((file) => file.id).toSorted());
  expect(new Set(groups.flat()).size).toBe(files.length);
  const totals = groups.map((group) =>
    group.reduce((sum, id) => sum + (profile.weights[`tests/${id.slice(1)}.ts`] ?? 2100), 0),
  );
  expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(2100);
});

it("lets Vitest's own file list reach exactly one shard, slowest known files first", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const profile = JSON.parse(
    await readFile(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
  );
  const known = Object.keys(profile.durations ?? profile.weights);
  const table = profile.durations ?? profile.weights;
  const files = [...known, "scripts/quality/test/new-file.test.mjs"].map((path) => ({
    project: { name: "" },
    moduleId: resolve(root, path),
  }));
  const shards = [];
  for (const index of [1, 2, 3, 4]) {
    const sequencer = new CiTestSequencer({ config: { root, shard: { index, count: 4 } } });
    shards.push(await sequencer.shard(files.toReversed()));
  }
  const assigned = shards.flat().map(({ moduleId }) => moduleId);
  expect(assigned.toSorted()).toEqual(files.map(({ moduleId }) => moduleId).toSorted());
  expect(new Set(assigned).size).toBe(files.length);

  const sequencer = new CiTestSequencer({
    config: { root },
    cache: { getFileTestResults() {}, getFileStats() {} },
  });
  const [first] = await sequencer.sort(files);
  const slowest = known.reduce((best, path) => (table[path] > table[best] ? path : best));
  expect(first.moduleId).toBe(resolve(root, slowest));
});
