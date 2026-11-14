import { CI_TEST_LEDGER_CONTRACT, CI_TEST_UNCACHEABLE_REASONS } from "./ci-test-ledger.mjs";
import { ciTestClosureInputs } from "./ci-test-shadow-index.mjs";
import { isCertainCiTestDigest, sameCiTestDigest } from "./ci-test-shadow-inputs.mjs";

/**
 * Shadow reuse prediction (ADR-0565, Stage 2). For every test file at the current head, it decides
 * whether Stage 3 could reuse an earlier result, or names the single reason the file would rerun.
 * It is pure: earlier runs arrive as data, and the head as digest lookups and an environment scan.
 * Nothing here selects, skips or judges a test. Anything it cannot prove identical reruns.
 *
 * An earlier result is reusable only when all of these hold:
 *
 * 1. Every run of the history window was loaded. One that failed to load could hold a failure.
 * 2. Its run is trusted, finished before the current run started, and recorded the file at most
 *    `ttlMs` (24 hours) before that start, in a ledger of the current contract.
 * 3. It recorded the same toolchain digest G as the file has at the head. G can differ between
 *    shards of one run, because hosted runners of one image release report different builds.
 * 4. The file passed, and its closure had no uncacheable reason.
 * 5. That run's input index covers the closure, every digest in it is certain, and the head has
 *    equal digests for the test file, every input and its `package.json` scopes, every copied tree
 *    and every resolution neighbourhood. Every recorded listing equals the head's listing of the
 *    same kind, and no recorded absent path exists.
 * 6. Neither the closure's sources nor its loaded packages name a run-unique variable.
 * 7. No run, trusted or not, recorded the file failing under the same G within the TTL.
 *
 * Candidates are tried newest first. A file without a reusable candidate reports the newest
 * candidate's reason, so a reason names the result Stage 3 would have tried first. A reason's
 * `detail` names the first differing input path or the differing toolchain components.
 */
export const CI_TEST_SHADOW_TTL_MS = 24 * 60 * 60 * 1000;
export const CI_TEST_RERUN_REASONS = Object.freeze([
  "history_incomplete",
  "no_history",
  "untrusted_history",
  "history_expired",
  "ledger_outdated",
  "toolchain_changed",
  "not_passed",
  ...CI_TEST_UNCACHEABLE_REASONS.map((reason) => `uncacheable_${reason}`),
  "input_digests_unavailable",
  "input_unverifiable",
  "input_changed",
  "resolution_changed",
  "tree_changed",
  "listing_changed",
  "absent_path_appeared",
  "run_environment_read",
  "prior_failure",
]);

const rerun = (reason, details = {}) => ({ reuse: false, reason, ...details });

/** Compares one indexed digest with the head's; `null` when they are provably the same. */
function compare(recorded, current, reason, path) {
  if (recorded === undefined) return rerun("input_digests_unavailable", { detail: path });
  if (!isCertainCiTestDigest(recorded) || !isCertainCiTestDigest(current))
    return rerun("input_unverifiable", { detail: path });
  return sameCiTestDigest(recorded, current) ? null : rerun(reason, { detail: path });
}

/** The first recorded input whose digest differs at the head, as a rerun, or `null`. */
function changedInput(record, index, head) {
  for (const path of ciTestClosureInputs(record)) {
    const changed = compare(index.inputs.get(path), head.input(path), "input_changed", path);
    if (changed !== null) return changed;
  }
  for (const path of [record.file, ...record.inputs]) {
    const changed = compare(
      index.neighbours.get(path),
      head.neighbours(path),
      "resolution_changed",
      path,
    );
    if (changed !== null) return changed;
  }
  for (const path of record.trees) {
    const changed = compare(index.trees.get(path), head.tree(path), "tree_changed", path);
    if (changed !== null) return changed;
  }
  for (const [path, kind, digests] of record.listings) {
    if (kind !== "plain" && kind !== "recursive")
      return rerun("input_unverifiable", { detail: path });
    if (!digests.every((digest) => digest.startsWith("sha256:")))
      return rerun("input_unverifiable", { detail: path });
    const current = head.listing(path, kind === "recursive");
    if (current === null || !digests.every((digest) => digest === current))
      return rerun("listing_changed", { detail: path });
  }
  for (const path of record.absent)
    if (head.exists(path)) return rerun("absent_path_appeared", { detail: path });
  return null;
}

/** The first source or loaded package that names a run-unique variable, or `null`. */
function runEnvironmentRead(record, environment) {
  for (const path of [record.file, ...record.inputs])
    if (environment.source(path)) return rerun("run_environment_read", { detail: path });
  for (const key of record.dependencies)
    if (environment.dependency(key)) return rerun("run_environment_read", { detail: key });
  return null;
}

/** Names of the toolchain components that differ, when both sides recorded them. */
function changedComponents(recorded, current) {
  if (!recorded || !current) return "unknown";
  const names = [...new Set([...Object.keys(recorded), ...Object.keys(current)])].sort();
  const changed = names.filter(
    (name) => JSON.stringify(recorded[name]) !== JSON.stringify(current[name]),
  );
  return changed.length > 0 ? changed.join(",") : "unknown";
}

function evaluate(candidate, { head, environment, toolchain, now, ttlMs }) {
  const { run, record, index } = candidate;
  const details = { run: run.id };
  if (!(now - record.observedAt <= ttlMs)) return rerun("history_expired", details);
  if (record.contract !== CI_TEST_LEDGER_CONTRACT) return rerun("ledger_outdated", details);
  if (record.toolchainDigest !== toolchain.digest)
    return rerun("toolchain_changed", {
      ...details,
      detail: changedComponents(record.toolchainComponents, toolchain.components),
    });
  if (record.result !== "passed") return rerun("not_passed", details);
  if (record.uncacheableReasons.length > 0)
    return rerun(`uncacheable_${record.uncacheableReasons[0]}`, details);
  if (index === null) return rerun("input_digests_unavailable", details);
  const changed = changedInput(record, index, head) ?? runEnvironmentRead(record, environment);
  if (changed !== null) return { ...changed, ...details };
  return { reuse: true, run: run.id, tests: record.tests };
}

/**
 * `files`: test files at the head as `{ file, toolchain: { digest, components } }`, with the
 * toolchain of the shard that runs each file. `history`: `{ complete, entries }`, where each entry
 * is `{ run: { id, trusted, availableAt }, files: Map<file, record>, index }` and `index` is the
 * run's read input index or `null`. `head`: input lookups of the head's reconstructed tree.
 * `environment`: the run-unique variable scan of that tree. `now`: the current run's start in
 * milliseconds. Returns `Map<file, prediction>`.
 */
export function predictCiTestReuse({
  files,
  history,
  head,
  environment,
  now,
  ttlMs = CI_TEST_SHADOW_TTL_MS,
}) {
  const predictions = new Map();
  if (history.complete !== true) {
    for (const { file } of files) predictions.set(file, rerun("history_incomplete"));
    return predictions;
  }
  const available = history.entries.filter(({ run }) => run.availableAt <= now);
  for (const { file, toolchain } of files) {
    const records = available.flatMap(({ run, files: recorded, index }) =>
      recorded.has(file) ? [{ run, record: recorded.get(file), index }] : [],
    );
    const candidates = records
      .filter(({ run }) => run.trusted)
      .sort((left, right) => right.record.observedAt - left.record.observedAt);
    if (candidates.length === 0) {
      predictions.set(file, rerun(records.length > 0 ? "untrusted_history" : "no_history"));
      continue;
    }
    const context = { head, environment, toolchain, now, ttlMs };
    let newest = null;
    let reusable = null;
    for (const candidate of candidates) {
      const evaluation = evaluate(candidate, context);
      newest ??= evaluation;
      if (evaluation.reuse) {
        reusable = evaluation;
        break;
      }
    }
    const failure = records.find(
      ({ record }) =>
        record.result !== "passed" &&
        record.result !== "skipped" &&
        record.toolchainDigest === toolchain.digest &&
        now - record.observedAt <= ttlMs,
    );
    if (reusable && failure) predictions.set(file, rerun("prior_failure", { run: failure.run.id }));
    else predictions.set(file, reusable ?? newest);
  }
  return predictions;
}
