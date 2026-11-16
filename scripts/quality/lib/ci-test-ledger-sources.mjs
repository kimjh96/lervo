import { resolve } from "node:path";

/**
 * Finds and downloads the shard ledgers of recent full Code quality runs for the timing profile
 * (ADR-0565). A run that reused an earlier run's results skips `Run tests` and uploads no ledger,
 * and a run with a failed or cancelled shard measured only part of that shard, so only successful
 * runs whose every shard ran its tests count. A run of an unmerged pull request could drop files
 * that main still has, so the tested head must be reachable from main. `gh(args)` runs the GitHub
 * CLI and returns stdout; `isOnMain(sha)` says whether main contains a commit.
 * The job, step and artifact names are the ones `code-quality-workflow.test.mjs` pins.
 */
const WORKFLOW = "code-quality.yml";
const SHARD_JOB = /^Tests \(shard (\d+)\/(\d+)\)$/u;
const SHARD_STEP = "Run tests";
const LEDGER_ARTIFACT = /^lervo-ci-test-ledger-(\d+)$/u;

/**
 * Says whether a run's jobs and artifacts show a full test run: the run succeeded, every shard job
 * ran `Run tests` successfully, and every shard's ledger artifact is still downloadable.
 */
export function isFullCiTestRun({ conclusion, jobs, artifacts }) {
  if (conclusion !== "success") return false;
  const shards = new Map();
  let count = null;
  for (const job of jobs) {
    const match = SHARD_JOB.exec(job.name);
    if (!match) continue;
    if (count !== null && Number(match[2]) !== count) return false;
    count = Number(match[2]);
    const step = (job.steps ?? []).find((candidate) => candidate.name === SHARD_STEP);
    shards.set(Number(match[1]), job.conclusion === "success" && step?.conclusion === "success");
  }
  if (count === null) return false;
  const ledgers = new Set(
    artifacts
      .filter((artifact) => !artifact.expired)
      .map((artifact) => Number(LEDGER_ARTIFACT.exec(artifact.name)?.[1])),
  );
  return Array.from({ length: count }, (_, index) => index + 1).every(
    (shard) => shards.get(shard) === true && ledgers.has(shard),
  );
}

/**
 * Returns the IDs of the newest `count` full runs whose head main contains, among the newest
 * `candidates` successful runs.
 */
export async function findCiTestLedgerRuns({ gh, isOnMain, count, candidates = 100 }) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(candidates) || candidates < 1)
    throw new Error("ci_duration_source_invalid");
  const listed = JSON.parse(
    await gh([
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--status",
      "success",
      "--limit",
      String(candidates),
      "--json",
      "databaseId,conclusion,headSha",
    ]),
  );
  const selected = [];
  for (const { databaseId, conclusion, headSha } of listed.toSorted(
    (left, right) => right.databaseId - left.databaseId,
  )) {
    if (selected.length === count) break;
    if (conclusion !== "success" || !(await isOnMain(headSha))) continue;
    const runId = String(databaseId);
    const { jobs } = JSON.parse(await gh(["run", "view", runId, "--json", "jobs"]));
    const { artifacts } = JSON.parse(
      await gh(["api", `repos/{owner}/{repo}/actions/runs/${runId}/artifacts?per_page=100`]),
    );
    if (isFullCiTestRun({ conclusion, jobs, artifacts })) selected.push(runId);
  }
  return selected;
}

/** Downloads each run's shard ledgers into `<directory>/<run>` and returns those directories. */
export async function downloadCiTestLedgerRuns({ gh, runIds, directory }) {
  const directories = [];
  for (const runId of runIds) {
    const target = resolve(directory, runId);
    await gh(["run", "download", runId, "--pattern", "lervo-ci-test-ledger-*", "--dir", target]);
    directories.push(target);
  }
  return directories;
}
