import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { readCiTestLedgerFiles } from "./ci-test-ledger.mjs";
import { readCiTestLedgers } from "./ci-test-ledger-runs.mjs";
import { readCiTestInputIndex } from "./ci-test-shadow-index.mjs";

/**
 * Loads earlier Code quality runs for the shadow predictor (ADR-0565, Stage 2) through the
 * read-only Actions API. Only runs of this workflow in this repository count; forks never do.
 * A run is trusted when it verified `main` (a push or the daily audit) or when it is a pull request
 * whose four test shards all succeeded. Untrusted runs still load their ledgers, because a failure
 * they recorded revokes reuse; a reused result only ever comes from a trusted run. Any API or
 * download failure skips that run and is reported, so it can only cause reruns.
 */
const WORKFLOW_PATH = ".github/workflows/code-quality.yml";
const SHARD_JOBS = [1, 2, 3, 4].map((shard) => `Tests (shard ${shard}/4)`);
export const CI_TEST_INPUT_INDEX_ARTIFACT = "lervo-ci-test-input-index";
const ledgerArtifact = /^lervo-ci-test-ledger-\d+$/u;
const defaultRunLimit = 25;

/** Reads one Actions API path with the job's read-only token. */
export function readCiTestHistoryApi(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
  );
}

/** Downloads named artifacts of one run into `directory`. */
export function downloadCiTestHistoryArtifacts({ repository, runId, names, directory }) {
  execFileSync(
    "gh",
    [
      "run",
      "download",
      String(runId),
      "-R",
      repository,
      "-D",
      directory,
      ...names.flatMap((name) => ["-n", name]),
    ],
    { stdio: "ignore" },
  );
}

/** Returns `{ use: false }` or `{ use: true, trusted }` for one run and its latest jobs. */
export function classifyCiTestHistoryRun({ run, jobs, repository }) {
  if (
    run?.path !== WORKFLOW_PATH ||
    run.status !== "completed" ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository
  )
    return { use: false };
  const verifiedMain = ["push", "schedule"].includes(run.event) && run.head_branch === "main";
  const succeeded = new Set(
    (jobs ?? []).filter((job) => job.conclusion === "success").map((job) => job.name),
  );
  const pullRequestPassed =
    run.event === "pull_request" && SHARD_JOBS.every((name) => succeeded.has(name));
  return { use: true, trusted: verifiedMain || pullRequestPassed };
}

async function findIndex(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const entry = entries.find(
    (candidate) => candidate.isFile() && candidate.name === "input-index.json",
  );
  return entry ? resolve(entry.parentPath, entry.name) : null;
}

/** Reads one downloaded run as the predictor's history entry; ledgers must name that run. */
export async function readCiTestHistoryRun({ run, trusted, directory }) {
  const ledgers = await readCiTestLedgers(directory);
  if (ledgers.some((ledger) => ledger.run.id !== String(run.id)))
    throw new Error("ci_test_history_run_mismatch");
  const files = new Map();
  for (const ledger of ledgers)
    for (const record of readCiTestLedgerFiles(ledger)) files.set(record.file, record);
  let index = null;
  const indexPath = trusted ? await findIndex(directory) : null;
  if (indexPath !== null) {
    index = readCiTestInputIndex(JSON.parse(await readFile(indexPath, "utf8")));
    if (index.run.id !== String(run.id) || index.run.revision !== ledgers[0].run.revision)
      throw new Error("ci_test_history_run_mismatch");
  }
  return {
    run: {
      id: String(run.id),
      event: run.event,
      branch: run.head_branch,
      trusted,
      availableAt: Date.parse(run.updated_at),
    },
    files,
    index,
  };
}

/**
 * Lists completed runs created since `since` (milliseconds), newest first, skipping the current
 * run, and loads at most `limit` that published ledgers. Returns `{ entries, skipped }`.
 */
export async function loadCiTestShadowHistory({
  repository,
  currentRunId,
  since,
  directory,
  limit = defaultRunLimit,
  request = readCiTestHistoryApi,
  download = downloadCiTestHistoryArtifacts,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository))
    throw new Error("ci_test_history_repository_invalid");
  const created = encodeURIComponent(`>=${new Date(since).toISOString()}`);
  const { workflow_runs: runs = [] } = request(
    `repos/${repository}/actions/workflows/code-quality.yml/runs?status=completed&created=${created}&per_page=100`,
  );
  const entries = [];
  const skipped = [];
  for (const run of runs
    .filter((candidate) => String(candidate.id) !== String(currentRunId))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))) {
    if (entries.length >= limit) break;
    try {
      const { artifacts = [] } = request(
        `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      const live = artifacts
        .filter((artifact) => !artifact.expired)
        .map((artifact) => artifact.name);
      const ledgers = live.filter((name) => ledgerArtifact.test(name));
      if (ledgers.length === 0) continue;
      const { jobs = [] } = request(
        `repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      );
      const classification = classifyCiTestHistoryRun({ run, jobs, repository });
      if (!classification.use) continue;
      const names = [...ledgers];
      if (classification.trusted && live.includes(CI_TEST_INPUT_INDEX_ARTIFACT))
        names.push(CI_TEST_INPUT_INDEX_ARTIFACT);
      const runDirectory = resolve(directory, String(run.id));
      await download({ repository, runId: run.id, names, directory: runDirectory });
      entries.push(
        await readCiTestHistoryRun({
          run,
          trusted: classification.trusted,
          directory: runDirectory,
        }),
      );
    } catch (error) {
      skipped.push({
        run: String(run.id),
        code: error?.message?.startsWith("ci_") ? error.message : "ci_test_history_unavailable",
      });
    }
  }
  return { entries, skipped };
}
