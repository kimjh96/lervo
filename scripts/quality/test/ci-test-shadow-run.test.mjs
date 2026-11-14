import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyCiTestHistoryRun,
  loadCiTestShadowHistory,
} from "../lib/ci-test-shadow-history.mjs";
import { createCiTestInputIndex } from "../lib/ci-test-shadow-index.mjs";
import { createCiTestInputSnapshot } from "../lib/ci-test-shadow-inputs.mjs";
import { readCiTestLedgerFiles } from "../lib/ci-test-ledger-read.mjs";
import { runCiTestShadow } from "../lib/ci-test-shadow-run.mjs";
import {
  SHADOW_TOOLCHAIN,
  shadowLedger,
  writeShadowLedger,
} from "./fixtures/ci-test-shadow-ledgers.mjs";

const repository = "owner/lervo";
/** Shard jobs; `ran` lists the shards whose `Run tests` step ran and so must have a ledger. */
const shardJobs = (conclusion = "success", ran = []) =>
  [1, 2, 3, 4].map((shard) => ({
    name: `Tests (shard ${shard}/4)`,
    conclusion: shard === 4 ? conclusion : "success",
    started_at: "2026-11-15T11:00:00Z",
    completed_at: "2026-11-15T11:10:00Z",
    steps: ran.includes(shard) ? [{ name: "Run tests", conclusion: "success" }] : [],
  }));
const runOf = (id, overrides = {}) => ({
  id,
  path: ".github/workflows/code-quality.yml",
  status: "completed",
  event: "pull_request",
  head_branch: "feature",
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  created_at: `2026-11-15T0${id % 10}:00:00Z`,
  updated_at: "2026-11-15T10:00:00Z",
  ...overrides,
});

describe("history trust", () => {
  it.each([
    [
      "a push to main",
      runOf(1, { event: "push", head_branch: "main" }),
      shardJobs("failure"),
      { use: true, trusted: true },
    ],
    [
      "the daily audit of main",
      runOf(1, { event: "schedule", head_branch: "main" }),
      [],
      { use: true, trusted: true },
    ],
    ["a pull request whose shards all passed", runOf(1), shardJobs(), { use: true, trusted: true }],
    [
      "a pull request with a failed shard",
      runOf(1),
      shardJobs("failure"),
      { use: true, trusted: false },
    ],
    [
      "a dispatched candidate",
      runOf(1, { event: "workflow_dispatch", head_branch: "lervo/release-cli" }),
      shardJobs(),
      { use: true, trusted: false },
    ],
    [
      "a fork pull request",
      runOf(1, { head_repository: { full_name: "fork/lervo" } }),
      shardJobs(),
      { use: false },
    ],
    [
      "another workflow",
      runOf(1, { path: ".github/workflows/other.yml" }),
      shardJobs(),
      { use: false },
    ],
    ["an unfinished run", runOf(1, { status: "in_progress" }), shardJobs(), { use: false }],
  ])("classifies %s", (_name, run, jobs, expected) => {
    expect(classifyCiTestHistoryRun({ run, jobs, repository })).toEqual(expected);
  });
});

describe("history loading", () => {
  const load = (request, options = {}) =>
    loadCiTestShadowHistory({
      repository,
      currentRunId: "9",
      since: 0,
      directory: tmpdir(),
      request,
      download: () => {},
      ...options,
    });

  it("fails closed when the run list cannot be read or has more pages than allowed", async () => {
    expect(
      await load(() => {
        throw new Error("rate limited");
      }),
    ).toEqual({
      complete: false,
      entries: [],
      problems: [{ run: null, code: "ci_test_history_unavailable" }],
    });
    const full = Array.from({ length: 100 }, (_, index) => runOf(1000 + index, { path: "other" }));
    expect(await load(() => ({ workflow_runs: full }), { maximumPages: 2 })).toMatchObject({
      complete: false,
      problems: [{ code: "ci_test_history_too_many_runs" }],
    });
  });

  it("skips forks and runs that executed no tests, and stays complete", async () => {
    const request = (path) => {
      if (path.includes("/workflows/"))
        return {
          workflow_runs: [runOf(5, { head_repository: { full_name: "fork/lervo" } }), runOf(4)],
        };
      if (path.includes("/artifacts")) return { artifacts: [] };
      return { jobs: shardJobs() };
    };
    expect(await load(request)).toEqual({ complete: true, entries: [], problems: [] });
  });
});

describe("shadow comparison", () => {
  let root;
  let revision;
  beforeEach(async () => {
    root = await mkdtemp(resolve(tmpdir(), "lervo-ci-shadow-run-"));
    for (const [path, content] of [
      ["a.test.ts", "a\n"],
      ["b.test.ts", "b\n"],
      ["src/a.ts", "a\n"],
      ["src/b.ts", "b\n"],
    ]) {
      await mkdir(resolve(root, "src"), { recursive: true });
      await writeFile(resolve(root, path), content);
    }
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "fixture");
    revision = git("rev-parse", "HEAD");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const files = (result = {}) => [
    { file: "a.test.ts", inputs: ["src/a.ts"], result: result.a },
    { file: "b.test.ts", inputs: ["src/b.ts"], result: result.b },
  ];

  /** Runs the shadow comparison with run 8 as trusted history and `extra` runs beside it. */
  async function compare({ extra = [], failDownload = [] } = {}) {
    const current = `${root}-current`;
    const output = `${current}-output`;
    await writeShadowLedger(
      current,
      shadowLedger({
        runId: "9",
        revision,
        observedAt: "2026-11-15T11:10:00Z",
        files: files({ b: "failed" }),
      }),
    );
    const earlier = shadowLedger({
      runId: "8",
      revision: "e".repeat(40),
      observedAt: "2026-11-15T09:00:00Z",
      files: files(),
    });
    const index = createCiTestInputIndex({
      run: { id: "8", revision: "e".repeat(40) },
      files: readCiTestLedgerFiles(earlier),
      snapshot: createCiTestInputSnapshot(root),
    });
    const ledgerOnly = { artifacts: [{ name: "lervo-ci-test-ledger-1" }] };
    const responses = new Map([
      [`repos/${repository}/actions/runs/9`, { run_started_at: "2026-11-15T11:00:00Z" }],
      [`repos/${repository}/actions/runs/9/jobs?filter=latest&per_page=100`, { jobs: shardJobs() }],
      [
        `repos/${repository}/actions/runs/8/artifacts?per_page=100`,
        { artifacts: [{ name: "lervo-ci-test-ledger-1" }, { name: "lervo-ci-test-input-index" }] },
      ],
      [
        `repos/${repository}/actions/runs/8/jobs?filter=latest&per_page=100`,
        { jobs: shardJobs("success", [1]) },
      ],
      [`repos/${repository}/actions/runs/7/artifacts?per_page=100`, ledgerOnly],
      [
        `repos/${repository}/actions/runs/7/jobs?filter=latest&per_page=100`,
        { jobs: shardJobs("success", [1]) },
      ],
      // Run 6 ran the tests of shard 2 but published no ledger for it.
      [`repos/${repository}/actions/runs/6/artifacts?per_page=100`, ledgerOnly],
      [
        `repos/${repository}/actions/runs/6/jobs?filter=latest&per_page=100`,
        { jobs: shardJobs("success", [1, 2]) },
      ],
    ]);
    const request = (path) => {
      if (path.startsWith(`repos/${repository}/actions/workflows/code-quality.yml/runs?`))
        return { workflow_runs: [runOf(9), runOf(8), ...extra.map((id) => runOf(id))] };
      if (!responses.has(path)) throw new Error(`unexpected ${path}`);
      return responses.get(path);
    };
    const download = async ({ runId, directory }) => {
      if (failDownload.includes(runId)) throw new Error("network");
      await writeShadowLedger(directory, {
        ...earlier,
        run: { ...earlier.run, id: String(runId) },
      });
      await mkdir(resolve(directory, "lervo-ci-test-input-index"), { recursive: true });
      await writeFile(
        resolve(directory, "lervo-ci-test-input-index/input-index.json"),
        JSON.stringify({ ...index, run: { ...index.run, id: String(runId) } }),
      );
    };
    const logged = [];
    try {
      const { report } = await runCiTestShadow({
        repositoryRoot: root,
        repository,
        ledgerDirectory: current,
        outputDirectory: output,
        request,
        download,
        log: (line) => logged.push(line),
      });
      const written = JSON.parse(await readFile(resolve(output, "index/input-index.json"), "utf8"));
      return { report, logged, written };
    } finally {
      await rm(current, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  }

  it("indexes this run, predicts from trusted history and lists a false reuse loudly", async () => {
    const { report, logged, written } = await compare();
    expect(report.summary).toEqual({
      files: 2,
      predictedReuse: 2,
      reuseRate: 1,
      falseReuses: 1,
      unverified: 0,
    });
    expect(report.falseReuses.map(({ file, fromRun }) => [file, fromRun])).toEqual([
      ["b.test.ts", "8"],
    ]);
    expect(logged).toEqual([
      expect.stringMatching(/^::error title=False test reuse::b\.test\.ts would reuse run 8/u),
    ]);
    expect(report.history).toEqual({
      complete: true,
      runs: [
        {
          id: "8",
          event: "pull_request",
          branch: "feature",
          trusted: true,
          availableAt: Date.parse("2026-11-15T10:00:00Z"),
          index: true,
        },
      ],
      problems: [],
    });
    expect(written).toMatchObject({ run: { id: "9", revision } });
    expect(report.toolchainDigests).toEqual([SHADOW_TOOLCHAIN]);
    expect(Object.keys(written.inputs)).toEqual([
      "a.test.ts",
      "b.test.ts",
      "package.json",
      "src/a.ts",
      "src/b.ts",
      "src/package.json",
    ]);
  });

  // r4 of the 2026-11-15 review: a run that failed to load may hold the failure that revokes reuse.
  it("r4: reruns every file when a run of the window fails to load or lacks a ledger", async () => {
    const failed = await compare({ extra: [7], failDownload: [7] });
    expect(failed.report.summary.predictedReuse).toBe(0);
    expect(failed.report.history).toMatchObject({
      complete: false,
      problems: [{ run: "7", code: "ci_test_history_unavailable" }],
    });
    expect(failed.report.rerunReasons.map(({ reason }) => reason)).toEqual(["history_incomplete"]);
    const missing = await compare({ extra: [6] });
    expect(missing.report.history.problems).toEqual([
      { run: "6", code: "ci_test_history_ledger_missing" },
    ]);
    expect(missing.report.summary.predictedReuse).toBe(0);
  });

  it("refuses ledgers recorded for another revision before writing anything", async () => {
    const current = `${root}-other`;
    await writeShadowLedger(
      current,
      shadowLedger({
        runId: "9",
        revision: "f".repeat(40),
        observedAt: "2026-11-15T11:10:00Z",
        files: files(),
      }),
    );
    await expect(
      runCiTestShadow({
        repositoryRoot: root,
        repository,
        ledgerDirectory: current,
        outputDirectory: `${current}-output`,
        request: () => ({}),
        download: () => {},
      }),
    ).rejects.toThrow("ci_test_shadow_revision_mismatch");
    await rm(current, { recursive: true, force: true });
  });
});
