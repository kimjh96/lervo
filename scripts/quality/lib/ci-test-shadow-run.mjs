import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readCiTestLedgerFiles } from "./ci-test-ledger-read.mjs";
import { readCiTestLedgers } from "./ci-test-ledger-runs.mjs";
import {
  downloadCiTestHistoryArtifacts,
  loadCiTestShadowHistory,
  readCiTestHistoryApi,
} from "./ci-test-shadow-history.mjs";
import { createCiTestEnvironmentScan } from "./ci-test-shadow-environment.mjs";
import { createCiTestInputIndex } from "./ci-test-shadow-index.mjs";
import { createCiTestInputSnapshot } from "./ci-test-shadow-inputs.mjs";
import { CI_TEST_SHADOW_TTL_MS, predictCiTestReuse } from "./ci-test-shadow-prediction.mjs";
import { createCiTestShadowReport, renderCiTestShadowReport } from "./ci-test-shadow-report.mjs";
import { CI_TEST_RUN_UNIQUE_ENVIRONMENT } from "./ci-test-toolchain-digest.mjs";

/**
 * One shadow comparison in the CI job that follows the test shards (ADR-0565, Stage 2). The job
 * reconstructs the shards' tree: the checkout, the frozen install and the restored build. This
 * writes the current run's input index first, so later runs can use it even if the rest fails,
 * then predicts reuse from earlier runs and compares it with this run's ledgers.
 */
const historyMarginMs = 6 * 60 * 60 * 1000;
const shardJob = /^Tests \(shard (\d+)\/4\)$/u;

const escapeCommand = (value) =>
  String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

function shardJobSeconds(jobs) {
  const seconds = new Map();
  for (const job of jobs) {
    const shard = shardJob.exec(job.name ?? "")?.[1];
    const elapsed = Date.parse(job.completed_at) - Date.parse(job.started_at);
    if (shard && Number.isFinite(elapsed) && elapsed >= 0)
      seconds.set(Number(shard), Math.round(elapsed / 1000));
  }
  return seconds;
}

async function writeJson(directory, name, value) {
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), `${JSON.stringify(value)}\n`);
}

/**
 * `request(path)` reads the Actions API and `download` fetches artifacts (both injected for
 * tests). Returns the report; writes `index/input-index.json` and `report/shadow-report.json`.
 */
export async function runCiTestShadow({
  repositoryRoot,
  repository,
  ledgerDirectory,
  outputDirectory,
  request = readCiTestHistoryApi,
  download = downloadCiTestHistoryArtifacts,
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const ledgers = await readCiTestLedgers(ledgerDirectory);
  const [{ run }] = ledgers;
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  if (head !== run.revision) throw new Error("ci_test_shadow_revision_mismatch");
  const files = ledgers.flatMap((ledger) => readCiTestLedgerFiles(ledger));
  const snapshot = createCiTestInputSnapshot(repositoryRoot);
  await writeJson(
    resolve(outputDirectory, "index"),
    "input-index.json",
    createCiTestInputIndex({ run, files, snapshot }),
  );

  const current = request(`repos/${repository}/actions/runs/${run.id}`);
  const now = Date.parse(current.run_started_at);
  if (!Number.isFinite(now)) throw new Error("ci_test_shadow_run_unavailable");
  const scratch = await mkdtemp(resolve(tmpdir(), "lervo-ci-test-shadow-"));
  try {
    const history = await loadCiTestShadowHistory({
      repository,
      currentRunId: run.id,
      since: now - CI_TEST_SHADOW_TTL_MS - historyMarginMs,
      directory: scratch,
      request,
      download,
    });
    // Each file keeps the toolchain of the shard that ran it, since shards can differ.
    const predictions = predictCiTestReuse({
      files: files.map((record) => ({
        file: record.file,
        toolchain: { digest: record.toolchainDigest, components: record.toolchainComponents },
      })),
      history,
      head: snapshot,
      environment: createCiTestEnvironmentScan(repositoryRoot, CI_TEST_RUN_UNIQUE_ENVIRONMENT),
      now,
    });
    const { jobs = [] } = request(
      `repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
    );
    const report = createCiTestShadowReport({
      run: {
        id: run.id,
        attempt: run.attempt,
        revision: run.revision,
        startedAt: current.run_started_at,
      },
      toolchainDigests: [...new Set(ledgers.map((ledger) => ledger.toolchain?.digest))].sort(),
      history: {
        complete: history.complete,
        runs: history.entries.map(({ run: entry, index }) => ({ ...entry, index: index !== null })),
        problems: history.problems,
      },
      predictions,
      actual: new Map(files.map((record) => [record.file, record])),
      jobSeconds: shardJobSeconds(jobs),
    });
    await writeJson(resolve(outputDirectory, "report"), "shadow-report.json", report);
    const markdown = renderCiTestShadowReport(report);
    await writeFile(resolve(outputDirectory, "report", "shadow-report.md"), markdown);
    for (const entry of report.falseReuses)
      log(
        `::error title=False test reuse::${escapeCommand(`${entry.file} would reuse run ${entry.fromRun} but ${JSON.stringify(entry.actual)}`)}`,
      );
    return { report, markdown };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
