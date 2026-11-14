/**
 * The committed CI timing profile. It holds only the slowest files so its size stays bounded;
 * every other file, including a new one, takes the profile's default weight. The profile changes
 * shard placement only, never which files run.
 */
export const CI_TEST_DURATION_PROFILE_LIMIT = 128;

const maximumDuration = 600_000;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
// Color codes arrive raw, or as a literal `^[` once `gh run view --log` sanitizes the log.
const colorCode = new RegExp(`(?:${String.fromCharCode(27)}|\\^\\[)\\[[0-9;]*m`, "gu");
// Vitest's module summary: `✓ path/to/file.test.ts (3 tests | 1 skipped) 1234ms`.
const moduleSummary =
  /(?:^|\s)((?:apps|packages|scripts)\/[\w./@-]+\.test\.(?:ts|mjs)) \(\d+ tests?(?: \| [^)]*)?\) (\d+)ms/u;

/**
 * Reads per-file durations from Vitest default-reporter output, such as `gh run view --log` for
 * all four shards. Prefixes like job names and timestamps are ignored. A file reported more than
 * once keeps its longest duration.
 */
export function parseVitestModuleDurations(text) {
  const durations = new Map();
  for (const line of text.replace(colorCode, "").split(/\r?\n/u)) {
    const match = moduleSummary.exec(line);
    if (!match) continue;
    const duration = Number(match[2]);
    if (duration > (durations.get(match[1]) ?? -1)) durations.set(match[1], duration);
  }
  return durations;
}

/** Keeps the slowest files, ordered by path so a refresh yields a reviewable diff. */
export function createCiTestDurationProfile({ durations, source, limit }) {
  const maximumEntries = limit ?? CI_TEST_DURATION_PROFILE_LIMIT;
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1)
    throw new Error("ci_duration_profile_invalid");
  const slowest = [...durations]
    .filter(([, duration]) => duration > 0)
    .sort(([leftPath, left], [rightPath, right]) => right - left || compare(leftPath, rightPath))
    .slice(0, maximumEntries)
    .map(([path, duration]) => [path, Math.min(Math.round(duration), maximumDuration)])
    .sort(([left], [right]) => compare(left, right));
  return {
    schemaVersion: 1,
    sourceRunId: source.runId,
    sourceRevision: source.revision,
    observedAt: source.observedAt,
    maximumEntries,
    durations: Object.fromEntries(slowest),
  };
}

/** Version 1 profiles hold test time only; the planner adds a 1.5-second per-file overhead. */
const legacyOverhead = 1500;
const validWeight = (weight) => Number.isFinite(weight) && weight >= 0 && weight <= maximumDuration;

/**
 * Returns `{ weights, defaultWeight }` in milliseconds, or rejects a profile the planner must not
 * trust. Version 2 weights are measured test plus collection time (ADR-0565); a file without an
 * entry takes the profile's default weight.
 */
export function readCiTestDurationProfile(profile) {
  const table = profile?.schemaVersion === 1 ? profile.durations : profile?.weights;
  if (
    ![1, 2].includes(profile?.schemaVersion) ||
    typeof table !== "object" ||
    table === null ||
    Object.keys(table).length > CI_TEST_DURATION_PROFILE_LIMIT ||
    !Object.values(table).every(validWeight) ||
    (profile.schemaVersion === 2 && !validWeight(profile.defaultWeight))
  )
    throw new Error("ci_duration_profile_invalid");
  if (profile.schemaVersion === 2)
    return { weights: { ...table }, defaultWeight: profile.defaultWeight };
  return {
    weights: Object.fromEntries(
      Object.entries(table).map(([path, duration]) => [path, duration + legacyOverhead]),
    ),
    defaultWeight: legacyOverhead,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Builds a version 2 profile from the ledgers of recent full runs (ADR-0565). Each file weighs the
 * median of its test plus collection time over the newest `window` runs, so one noisy run cannot
 * move it. A file that no selected run measured keeps its current weight only while a selected run
 * is missing a shard; otherwise it no longer exists. Files below the slowest `limit` take the
 * median of their own weights as the default.
 */
export function createCiTestWeightProfile({ runs, current, window = 5, limit, observedAt }) {
  const maximumEntries = limit ?? CI_TEST_DURATION_PROFILE_LIMIT;
  if (!Number.isInteger(window) || window < 1 || !Number.isInteger(maximumEntries))
    throw new Error("ci_duration_profile_invalid");
  const selected = [...runs]
    .sort((left, right) => Number(right.runId) - Number(left.runId))
    .slice(0, window);
  if (selected.length === 0) throw new Error("ci_duration_ledgers_empty");
  const samples = new Map();
  for (const run of selected)
    for (const [path, weight] of run.weights) {
      if (!samples.has(path)) samples.set(path, []);
      samples.get(path).push(weight);
    }
  const measured = new Map([...samples].map(([path, values]) => [path, median(values)]));
  const weights = new Map(measured);
  if (selected.some((run) => !run.complete))
    for (const [path, weight] of Object.entries(current.weights))
      if (!weights.has(path)) weights.set(path, weight);
  const ranked = [...weights]
    .map(([path, weight]) => [path, Math.min(Math.round(weight), maximumDuration)])
    .sort(([leftPath, left], [rightPath, right]) => right - left || compare(leftPath, rightPath));
  const kept = ranked.slice(0, maximumEntries);
  const tail = ranked.slice(maximumEntries).filter(([path]) => measured.has(path));
  return {
    schemaVersion: 2,
    statistic: "median",
    window,
    sources: selected.map(({ runId, revision }) => ({ runId, revision })),
    observedAt,
    maximumEntries,
    defaultWeight:
      tail.length === 0
        ? current.defaultWeight
        : Math.round(median(tail.map(([, weight]) => weight))),
    weights: Object.fromEntries(kept.sort(([left], [right]) => compare(left, right))),
  };
}
