import { expect, it } from "vitest";

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
