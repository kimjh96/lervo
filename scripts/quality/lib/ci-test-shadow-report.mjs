/**
 * Shadow reuse report (ADR-0565, Stage 2). It compares each prediction with what the current run
 * actually observed, because every test still runs in this stage. A false reuse is a predicted
 * reuse whose actual result or test counts differ from the reused result; a changed duration is
 * not one. The report is evidence for the Stage 3 decision only and never judges the run.
 */
export const CI_TEST_SHADOW_CONTRACT = "lervo-ci-test-shadow-v1";
const sampleLimit = 10;
const workersPerShard = 2;

const sameTests = (left, right) =>
  ["passed", "failed", "skipped", "pending"].every(
    (key) => (left?.[key] ?? 0) === (right?.[key] ?? 0),
  );
const seconds = (milliseconds) => Math.round(milliseconds / 100) / 10;

/** Rerun reasons by file count, with the file time this run spent on them and common details. */
function rankReasons(predictions, actual) {
  const reasons = new Map();
  for (const [file, prediction] of predictions) {
    if (prediction.reuse) continue;
    const entry = reasons.get(prediction.reason) ?? {
      files: 0,
      milliseconds: 0,
      samples: [],
      details: new Map(),
    };
    const record = actual.get(file);
    entry.files += 1;
    entry.milliseconds += record ? record.durationMs + record.collectMs : 0;
    if (entry.samples.length < sampleLimit) entry.samples.push(file);
    if (prediction.detail)
      entry.details.set(prediction.detail, (entry.details.get(prediction.detail) ?? 0) + 1);
    reasons.set(prediction.reason, entry);
  }
  return [...reasons]
    .map(([reason, { files, milliseconds, samples, details }]) => ({
      reason,
      files,
      fileSeconds: seconds(milliseconds),
      samples,
      details: [...details]
        .sort(
          ([leftPath, left], [rightPath, right]) => right - left || (leftPath < rightPath ? -1 : 1),
        )
        .slice(0, sampleLimit)
        .map(([detail, count]) => ({ detail, files: count })),
    }))
    .sort((left, right) => right.files - left.files || (left.reason < right.reason ? -1 : 1));
}

/**
 * Per shard: file time executed, file time that would still run, and, when the shard job's
 * duration is known, that duration less the reusable file time spread over the shard's workers.
 * The estimate keeps the current placement; it is not a measurement.
 */
function shardTimes(actual, predictions, jobSeconds) {
  const shards = new Map();
  for (const record of actual.values()) {
    const shard = shards.get(record.shard) ?? {
      index: record.shard,
      files: 0,
      reused: 0,
      executedMs: 0,
      rerunMs: 0,
    };
    const milliseconds = record.durationMs + record.collectMs;
    shard.files += 1;
    shard.executedMs += milliseconds;
    if (predictions.get(record.file)?.reuse) shard.reused += 1;
    else shard.rerunMs += milliseconds;
    shards.set(record.shard, shard);
  }
  return [...shards.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ index, files, reused, executedMs, rerunMs }) => {
      const job = jobSeconds.get(index);
      return {
        index,
        files,
        reused,
        executedFileSeconds: seconds(executedMs),
        rerunFileSeconds: seconds(rerunMs),
        jobSeconds: job ?? null,
        estimatedJobSeconds:
          job === undefined
            ? null
            : Math.max(0, Math.round(job - (executedMs - rerunMs) / workersPerShard / 1000)),
      };
    });
}

/**
 * `toolchainDigests`: the distinct G of the current run's shards. `actual`: `Map<file, record>` of
 * the current run's ledgers. `predictions`: from
 * `predictCiTestReuse`. `jobSeconds`: `Map<shard, seconds>` of the current shard jobs.
 */
export function createCiTestShadowReport({
  run,
  toolchainDigests,
  history,
  predictions,
  actual,
  jobSeconds = new Map(),
}) {
  const falseReuses = [];
  const unverified = [];
  let reused = 0;
  for (const [file, prediction] of predictions) {
    if (!prediction.reuse) continue;
    reused += 1;
    const record = actual.get(file);
    if (record === undefined) unverified.push(file);
    else if (record.result !== "passed" || !sameTests(record.tests, prediction.tests))
      falseReuses.push({
        file,
        fromRun: prediction.run,
        expected: { result: "passed", tests: prediction.tests },
        actual: { result: record.result, tests: record.tests },
      });
  }
  return {
    schemaVersion: 1,
    contract: CI_TEST_SHADOW_CONTRACT,
    run,
    toolchainDigests,
    history,
    summary: {
      files: predictions.size,
      predictedReuse: reused,
      reuseRate: predictions.size === 0 ? 0 : Math.round((reused / predictions.size) * 1000) / 1000,
      falseReuses: falseReuses.length,
      unverified: unverified.length,
    },
    falseReuses: falseReuses.sort((left, right) => (left.file < right.file ? -1 : 1)),
    unverified: unverified.sort(),
    rerunReasons: rankReasons(predictions, actual),
    shards: shardTimes(actual, predictions, jobSeconds),
    files: [...predictions]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([file, prediction]) =>
        prediction.reuse
          ? { file, reuse: true, run: prediction.run }
          : {
              file,
              reuse: false,
              reason: prediction.reason,
              run: prediction.run ?? null,
              detail: prediction.detail ?? null,
            },
      ),
  };
}

const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

/** Markdown for the job summary; false reuses come first so they cannot be missed. */
export function renderCiTestShadowReport(report) {
  const { summary } = report;
  const lines = [
    "## Test reuse shadow (ADR-0565, Stage 2)",
    "",
    `Predicted reuse: ${summary.predictedReuse} of ${summary.files} files (${(summary.reuseRate * 100).toFixed(1)}%). ` +
      `Trusted history runs: ${report.history.filter((entry) => entry.trusted).length}.`,
    "",
  ];
  if (summary.falseReuses > 0) {
    lines.push(
      `### FALSE REUSE: ${summary.falseReuses} files`,
      "",
      "| File | From run | Actual |",
      "| --- | --- | --- |",
    );
    for (const entry of report.falseReuses)
      lines.push(
        `| ${cell(entry.file)} | ${entry.fromRun} | ${cell(JSON.stringify(entry.actual))} |`,
      );
    lines.push("");
  } else lines.push("No false reuse.", "");
  if (summary.unverified > 0)
    lines.push(`Predicted reuses without a result in this run: ${summary.unverified}.`, "");
  lines.push(
    "| Shard | Files | Reusable | File time (s) | Would rerun (s) | Job (s) | Estimated job (s) |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const shard of report.shards)
    lines.push(
      `| ${shard.index} | ${shard.files} | ${shard.reused} | ${shard.executedFileSeconds} | ${shard.rerunFileSeconds} | ${shard.jobSeconds ?? "-"} | ${shard.estimatedJobSeconds ?? "-"} |`,
    );
  lines.push(
    "",
    "| Rerun reason | Files | File time (s) | Most common detail |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of report.rerunReasons)
    lines.push(
      `| ${entry.reason} | ${entry.files} | ${entry.fileSeconds} | ${cell(entry.details[0]?.detail ?? "-")} |`,
    );
  return `${lines.join("\n")}\n`;
}
