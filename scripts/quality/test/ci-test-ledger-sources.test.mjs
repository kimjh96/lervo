import { resolve } from "node:path";

import { expect, it } from "vitest";

import {
  downloadCiTestLedgerRuns,
  findCiTestLedgerRuns,
  isFullCiTestRun,
} from "../lib/ci-test-ledger-sources.mjs";

const shardJob = (shard, { conclusion = "success", tests = "success", count = 4 } = {}) => ({
  name: `Tests (shard ${shard}/${count})`,
  conclusion,
  steps: [
    { name: "Reuse verified tests for identical content", conclusion: "skipped" },
    { name: "Run tests", conclusion: tests },
  ],
});
const fullJobs = () => [
  { name: "Plan verification", conclusion: "success", steps: [] },
  ...[1, 2, 3, 4].map((shard) => shardJob(shard)),
];
const ledgerArtifacts = (shards = [1, 2, 3, 4], expired = false) => [
  { name: "workspace-build", expired: false },
  ...shards.map((shard) => ({ name: `lervo-ci-test-ledger-${shard}`, expired })),
];

it("counts a run only when every shard ran its tests and left a downloadable ledger", () => {
  const full = { conclusion: "success", jobs: fullJobs(), artifacts: ledgerArtifacts() };
  expect(isFullCiTestRun(full)).toBe(true);
  // A run that reused an earlier run's results skips `Run tests` and uploads no ledger.
  const reused = [1, 2, 3, 4].map((shard) => shardJob(shard, { tests: "skipped" }));
  for (const run of [
    { ...full, conclusion: "failure" },
    { ...full, jobs: reused, artifacts: ledgerArtifacts([]) },
    { ...full, jobs: reused },
    { ...full, jobs: fullJobs().slice(0, 4) },
    { ...full, jobs: [...fullJobs().slice(0, 4), shardJob(4, { conclusion: "failure" })] },
    { ...full, jobs: [...fullJobs().slice(0, 4), shardJob(4, { tests: "cancelled" })] },
    { ...full, jobs: [...fullJobs().slice(0, 4), shardJob(4, { count: 5 })] },
    { ...full, jobs: [{ name: "Plan verification", conclusion: "success", steps: [] }] },
    { ...full, artifacts: ledgerArtifacts([1, 2, 3]) },
    { ...full, artifacts: ledgerArtifacts([1, 2, 3, 4], true) },
  ])
    expect(isFullCiTestRun(run)).toBe(false);
});

function fakeGh(runs) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const [command, subcommand] = args;
    if (command === "run" && subcommand === "list")
      return JSON.stringify(
        runs.map(({ databaseId, conclusion, headSha }) => ({ databaseId, conclusion, headSha })),
      );
    if (command === "run" && subcommand === "view")
      return JSON.stringify({ jobs: runs.find((run) => String(run.databaseId) === args[2]).jobs });
    if (command === "api") {
      const runId = /runs\/(\d+)\/artifacts/u.exec(subcommand)[1];
      const run = runs.find((candidate) => String(candidate.databaseId) === runId);
      return JSON.stringify({ artifacts: run.artifacts });
    }
    if (command === "run" && subcommand === "download") return "";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls };
}

it("selects the newest full runs of main and stops once it has enough", async () => {
  const run = (databaseId, jobs = fullJobs(), artifacts = ledgerArtifacts()) => ({
    databaseId,
    conclusion: "success",
    headSha: String(databaseId).padStart(40, "0"),
    jobs,
    artifacts,
  });
  const reused = [1, 2, 3, 4].map((shard) => shardJob(shard, { tests: "skipped" }));
  const { gh, calls } = fakeGh([
    run(30),
    run(50, reused, ledgerArtifacts([])),
    run(10),
    run(40),
    run(60),
    run(20),
  ]);
  // Run 60 tested an unmerged pull request head, so its file list and timings never count.
  const isOnMain = async (sha) => sha !== "60".padStart(40, "0");
  expect(await findCiTestLedgerRuns({ gh, isOnMain, count: 3 })).toEqual(["40", "30", "20"]);
  expect(calls[0]).toEqual([
    "run",
    "list",
    "--workflow",
    "code-quality.yml",
    "--status",
    "success",
    "--limit",
    "100",
    "--json",
    "databaseId,conclusion,headSha",
  ]);
  expect(calls.some((args) => args.includes("60"))).toBe(false);
  // Run 10 is never inspected once three full runs are found.
  expect(calls.some((args) => args.includes("10"))).toBe(false);
  expect(await findCiTestLedgerRuns({ gh, isOnMain, count: 9 })).toEqual(["40", "30", "20", "10"]);
  for (const count of [0, 1.5])
    await expect(findCiTestLedgerRuns({ gh, isOnMain, count })).rejects.toThrow(
      "ci_duration_source_invalid",
    );
});

it("downloads each selected run's ledgers into its own directory", async () => {
  const { gh, calls } = fakeGh([]);
  const directories = await downloadCiTestLedgerRuns({
    gh,
    runIds: ["40", "30"],
    directory: "/ledgers",
  });
  expect(directories).toEqual([resolve("/ledgers", "40"), resolve("/ledgers", "30")]);
  expect(calls).toEqual(
    ["40", "30"].map((runId) => [
      "run",
      "download",
      runId,
      "--pattern",
      "lervo-ci-test-ledger-*",
      "--dir",
      resolve("/ledgers", runId),
    ]),
  );
});
