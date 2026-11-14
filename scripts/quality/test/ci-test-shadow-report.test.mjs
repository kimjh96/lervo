import { expect, it } from "vitest";

import {
  CI_TEST_SHADOW_CONTRACT,
  createCiTestShadowReport,
  renderCiTestShadowReport,
} from "../lib/ci-test-shadow-report.mjs";

const tests = (passed, failed = 0) => ({ passed, failed, skipped: 0, pending: 0 });
const actual = (file, shard, overrides = {}) => [
  file,
  {
    file,
    shard,
    result: "passed",
    tests: tests(2),
    durationMs: 4000,
    collectMs: 2000,
    ...overrides,
  },
];

const completeHistory = {
  complete: true,
  runs: [{ id: "8", trusted: true, index: true }],
  problems: [],
};

function report(
  predictions,
  records,
  jobSeconds = new Map([
    [1, 300],
    [2, 200],
  ]),
  history = completeHistory,
) {
  return createCiTestShadowReport({
    run: { id: "9", attempt: "1", revision: "b".repeat(40) },
    toolchainDigests: ["sha256:toolchain"],
    history,
    predictions: new Map(predictions),
    actual: new Map(records),
    jobSeconds,
  });
}

it("lists a predicted reuse whose actual result or test counts differ as a false reuse", () => {
  const result = report(
    [
      ["a.test.ts", { reuse: true, run: "8", tests: tests(2) }],
      ["b.test.ts", { reuse: true, run: "8", tests: tests(2) }],
      ["c.test.ts", { reuse: true, run: "7", tests: tests(2) }],
      ["d.test.ts", { reuse: true, run: "8", tests: tests(2) }],
      ["e.test.ts", { reuse: true, run: "8", tests: tests(2) }],
    ],
    [
      actual("a.test.ts", 1, { durationMs: 9000 }),
      actual("b.test.ts", 1, { result: "failed", tests: tests(1, 1) }),
      actual("c.test.ts", 2, { tests: tests(3) }),
      actual("e.test.ts", 2),
    ],
  );
  expect(result.contract).toBe(CI_TEST_SHADOW_CONTRACT);
  expect(result.summary).toEqual({
    files: 5,
    predictedReuse: 5,
    reuseRate: 1,
    falseReuses: 2,
    unverified: 1,
  });
  expect(result.falseReuses).toEqual([
    {
      file: "b.test.ts",
      fromRun: "8",
      expected: { result: "passed", tests: tests(2) },
      actual: { result: "failed", tests: tests(1, 1) },
    },
    {
      file: "c.test.ts",
      fromRun: "7",
      expected: { result: "passed", tests: tests(2) },
      actual: { result: "passed", tests: tests(3) },
    },
  ]);
  expect(result.unverified).toEqual(["d.test.ts"]);
  const markdown = renderCiTestShadowReport(result);
  expect(markdown).toContain("### FALSE REUSE: 2 files");
  expect(markdown.indexOf("FALSE REUSE")).toBeLessThan(markdown.indexOf("| Shard |"));
});

it("ranks rerun reasons with their most common details and estimates shard time", () => {
  const result = report(
    [
      ["a.test.ts", { reuse: true, run: "8", tests: tests(2) }],
      [
        "b.test.ts",
        { reuse: false, reason: "input_changed", detail: "packages/core/src/x.ts", run: "8" },
      ],
      [
        "c.test.ts",
        { reuse: false, reason: "input_changed", detail: "packages/core/src/x.ts", run: "8" },
      ],
      ["d.test.ts", { reuse: false, reason: "no_history" }],
    ],
    [
      actual("a.test.ts", 1),
      actual("b.test.ts", 1),
      actual("c.test.ts", 2),
      actual("d.test.ts", 2),
    ],
  );
  expect(result.summary).toMatchObject({ predictedReuse: 1, reuseRate: 0.25, falseReuses: 0 });
  expect(result.rerunReasons).toEqual([
    {
      reason: "input_changed",
      files: 2,
      fileSeconds: 12,
      samples: ["b.test.ts", "c.test.ts"],
      details: [{ detail: "packages/core/src/x.ts", files: 2 }],
    },
    { reason: "no_history", files: 1, fileSeconds: 6, samples: ["d.test.ts"], details: [] },
  ]);
  expect(result.shards).toEqual([
    {
      index: 1,
      files: 2,
      reused: 1,
      executedFileSeconds: 12,
      rerunFileSeconds: 6,
      jobSeconds: 300,
      estimatedJobSeconds: 297,
    },
    {
      index: 2,
      files: 2,
      reused: 0,
      executedFileSeconds: 12,
      rerunFileSeconds: 12,
      jobSeconds: 200,
      estimatedJobSeconds: 200,
    },
  ]);
  expect(result.files[1]).toEqual({
    file: "b.test.ts",
    reuse: false,
    reason: "input_changed",
    run: "8",
    detail: "packages/core/src/x.ts",
  });
  expect(renderCiTestShadowReport(result)).toContain("No false reuse.");
});

it("leaves the job estimate empty when the shard job duration is unknown", () => {
  const result = report(
    [["a.test.ts", { reuse: false, reason: "no_history" }]],
    [actual("a.test.ts", 3)],
    new Map(),
  );
  expect(result.shards).toEqual([
    {
      index: 3,
      files: 1,
      reused: 0,
      executedFileSeconds: 6,
      rerunFileSeconds: 6,
      jobSeconds: null,
      estimatedJobSeconds: null,
    },
  ]);
});

it("says first that an incomplete history made every file rerun", () => {
  const result = report(
    [["a.test.ts", { reuse: false, reason: "history_incomplete" }]],
    [actual("a.test.ts", 1)],
    new Map(),
    { complete: false, runs: [], problems: [{ run: "7", code: "ci_test_history_unavailable" }] },
  );
  const markdown = renderCiTestShadowReport(result);
  expect(markdown).toContain(
    "History incomplete, so every file reruns: 7 ci_test_history_unavailable.",
  );
  expect(markdown.indexOf("History incomplete")).toBeLessThan(markdown.indexOf("| Shard |"));
});
