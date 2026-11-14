/**
 * The committed CI timing profile. It holds only the slowest files so its size stays bounded;
 * every other file, including a new one, takes the shard planner's default weight. The profile
 * changes shard placement only, never which files run.
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

/** Returns the profile's durations, or rejects a profile the planner must not trust. */
export function readCiTestDurationProfile(profile) {
  const durations = profile?.durations;
  if (
    profile?.schemaVersion !== 1 ||
    typeof durations !== "object" ||
    durations === null ||
    Object.keys(durations).length > CI_TEST_DURATION_PROFILE_LIMIT ||
    Object.values(durations).some(
      (duration) => !Number.isFinite(duration) || duration < 0 || duration > maximumDuration,
    )
  )
    throw new Error("ci_duration_profile_invalid");
  return durations;
}
