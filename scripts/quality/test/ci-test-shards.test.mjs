import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, it } from "vitest";

import { readCiTestDurationProfile } from "../lib/ci-test-duration-profile.mjs";
import CiTestSequencer from "../lib/ci-test-sequencer.mjs";
import { assignCiTestShards } from "../lib/ci-test-shards.mjs";

it("balances heavy files while covering every known or new file exactly once", () => {
  const files = Array.from({ length: 200 }, (_, i) => ({ id: `test-${i}`, path: `tests/${i}.ts` }));
  const durations = { "tests/0.ts": 100_000, "tests/1.ts": 80_000, "tests/2.ts": 60_000 };
  const groups = assignCiTestShards(files, durations, 4);
  expect(groups.flat().toSorted()).toEqual(files.map((file) => file.id).toSorted());
  expect(groups).toEqual(assignCiTestShards(files.toReversed(), durations, 4));
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
  expect(() => assignCiTestShards([file, file], {}, 4)).toThrow("ci_test_identity_duplicate");
  for (const count of [0, 17, 1.5])
    expect(() => assignCiTestShards([file], {}, count)).toThrow("ci_shard_coordinates_invalid");
  expect(() => assignCiTestShards([file], { "one.ts": -1 }, 4)).toThrow("ci_test_duration_invalid");
});

it("balances the committed profile with new files to within one default weight", async () => {
  const profile = JSON.parse(
    await readFile(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
  );
  const durations = readCiTestDurationProfile(profile);
  const paths = [
    ...Object.keys(durations),
    ...Array.from({ length: 1150 }, (_, i) => `packages/new/test/file-${i}.test.ts`),
  ];
  const groups = assignCiTestShards(
    paths.map((path) => ({ id: path, path })),
    durations,
    4,
  );
  expect(groups.flat().toSorted()).toEqual(paths.toSorted());
  const weights = groups.map((group) =>
    group.reduce((sum, path) => sum + 1500 + (durations[path] ?? 0), 0),
  );
  expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(1500);
});

it("lets Vitest's own file list reach exactly one shard, slowest known files first", async () => {
  const root = resolve(import.meta.dirname, "../../..");
  const profile = JSON.parse(
    await readFile(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
  );
  const known = Object.keys(profile.durations);
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
  const slowest = known.reduce((best, path) =>
    profile.durations[path] > profile.durations[best] ? path : best,
  );
  expect(first.moduleId).toBe(resolve(root, slowest));
});
