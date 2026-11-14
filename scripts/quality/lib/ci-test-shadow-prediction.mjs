import { CI_TEST_UNCACHEABLE_REASONS } from "./ci-test-ledger.mjs";
import { CI_TEST_INPUT_UNREADABLE } from "./ci-test-shadow-inputs.mjs";

/**
 * Shadow reuse prediction (ADR-0565, Stage 2). For every test file at the current head, it decides
 * whether Stage 3 could reuse an earlier result, or names the single reason the file would rerun.
 * It is pure: earlier runs arrive as data and the head as digest lookups. Nothing here selects,
 * skips or judges a test.
 *
 * An earlier result is reusable only when all of these hold:
 *
 * 1. Its run is trusted, finished before the current run started, and recorded the file at most
 *    `ttlMs` (24 hours) before that start.
 * 2. It recorded the same toolchain digest G as the file has at the head. G can differ between
 *    shards of one run, because hosted runners of one image release report different builds.
 * 3. The file passed there, and its closure had no uncacheable reason.
 * 4. That run's input index covers the file, and the head has the same digest for the file, every
 *    recorded input and every copied tree, every recorded listing digest, and no recorded absent
 *    path. An unreadable digest never matches.
 * 5. No run, trusted or not, recorded the file failing under the same G within the TTL.
 *
 * Candidates are tried newest first. A file without a reusable candidate reports the newest
 * candidate's reason, so a reason names the result Stage 3 would have tried first. A reason's
 * `detail` names the first differing input path or the differing toolchain components.
 */
export const CI_TEST_SHADOW_TTL_MS = 24 * 60 * 60 * 1000;
export const CI_TEST_RERUN_REASONS = Object.freeze([
  "no_history",
  "untrusted_history",
  "history_expired",
  "toolchain_changed",
  "not_passed",
  ...CI_TEST_UNCACHEABLE_REASONS.map((reason) => `uncacheable_${reason}`),
  "input_digests_unavailable",
  "input_changed",
  "tree_changed",
  "listing_changed",
  "absent_path_appeared",
  "prior_failure",
]);

const rerun = (reason, details = {}) => ({ reuse: false, reason, ...details });

/** The first recorded input whose digest differs at the head, as a rerun, or `null`. */
function changedInput(record, index, head) {
  for (const path of [record.file, ...record.inputs]) {
    const recorded = index.inputs.get(path);
    if (recorded === undefined) return rerun("input_digests_unavailable", { detail: path });
    if (recorded === CI_TEST_INPUT_UNREADABLE || head.input(path) !== recorded)
      return rerun("input_changed", { detail: path });
  }
  for (const path of record.trees) {
    const recorded = index.trees.get(path);
    if (recorded === undefined) return rerun("input_digests_unavailable", { detail: path });
    if (recorded === CI_TEST_INPUT_UNREADABLE || head.tree(path) !== recorded)
      return rerun("tree_changed", { detail: path });
  }
  for (const [path, digests] of record.directories) {
    // A recorded digest says whether its listing was recursive, so the plain one is tried first.
    const matches = (digest) =>
      digest === head.listing(path, false) || digest === head.listing(path, true);
    if (!digests.every(matches)) return rerun("listing_changed", { detail: path });
  }
  for (const path of record.absent)
    if (head.exists(path)) return rerun("absent_path_appeared", { detail: path });
  return null;
}

/** Names of the toolchain components that differ, when both sides recorded them. */
function changedComponents(recorded, current) {
  if (!recorded || !current) return "unknown";
  const names = [...new Set([...Object.keys(recorded), ...Object.keys(current)])].sort();
  const changed = names.filter((name) => recorded[name] !== current[name]);
  return changed.length > 0 ? changed.join(",") : "unknown";
}

function evaluate(candidate, head, { toolchain, now, ttlMs }) {
  const { run, record, index } = candidate;
  const details = { run: run.id };
  if (!(now - record.observedAt <= ttlMs)) return rerun("history_expired", details);
  if (record.toolchainDigest !== toolchain.digest)
    return rerun("toolchain_changed", {
      ...details,
      detail: changedComponents(record.toolchainComponents, toolchain.components),
    });
  if (record.result !== "passed") return rerun("not_passed", details);
  if (record.uncacheableReasons.length > 0)
    return rerun(`uncacheable_${record.uncacheableReasons[0]}`, details);
  if (index === null) return rerun("input_digests_unavailable", details);
  const changed = changedInput(record, index, head);
  if (changed !== null) return { ...changed, ...details };
  return { reuse: true, run: run.id, tests: record.tests };
}

/**
 * `files`: test files at the head as `{ file, toolchain: { digest, components } }`, with the
 * toolchain of the shard that runs each file. `history`: earlier runs as
 * `{ run: { id, trusted, availableAt }, files: Map<file, record>, index }`, where `index` is the
 * run's read input index or `null`. `head`: input lookups of the head's reconstructed tree.
 * `now`: the current run's start in milliseconds. Returns `Map<file, prediction>`.
 */
export function predictCiTestReuse({ files, history, head, now, ttlMs = CI_TEST_SHADOW_TTL_MS }) {
  const available = history.filter(({ run }) => run.availableAt <= now);
  const predictions = new Map();
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
    let newest = null;
    let reusable = null;
    for (const candidate of candidates) {
      const evaluation = evaluate(candidate, head, { toolchain, now, ttlMs });
      newest ??= evaluation;
      if (evaluation.reuse) {
        reusable = evaluation;
        break;
      }
    }
    const failure = records.find(
      ({ record }) =>
        record.result === "failed" &&
        record.toolchainDigest === toolchain.digest &&
        now - record.observedAt <= ttlMs,
    );
    if (reusable && failure) predictions.set(file, rerun("prior_failure", { run: failure.run.id }));
    else predictions.set(file, reusable ?? newest);
  }
  return predictions;
}
