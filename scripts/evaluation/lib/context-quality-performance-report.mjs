export function interval(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error("Invalid interval samples");
  const mean = (items) => items.reduce((a, b) => a + b, 0) / items.length;
  let seed = 501;
  const draws = Array.from({ length: 10000 }, () =>
    mean(
      values.map(() => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return values[(seed >>> 0) % values.length];
      }),
    ),
  ).sort((a, b) => a - b);
  return { mean: mean(values), lower95: draws[249], upper95: draws[9749] };
}

const positive = (value) => Number.isFinite(value) && value > 0;
const nonnegative = (value) => Number.isFinite(value) && value >= 0;

function validObservation(sample) {
  return (
    nonnegative(sample.elapsedMs) &&
    nonnegative(sample.cpuMs) &&
    typeof sample.status === "string" &&
    typeof sample.planDigest === "string" &&
    sample.planDigest.length > 0 &&
    nonnegative(sample.preparedBytes)
  );
}

function completeLifecycle(results, lifecycle, protocol) {
  const count = lifecycle === "warm" ? protocol.warmPairs : protocol.coldPairs;
  const rows = results.filter((r) => r.lifecycle === lifecycle);
  if (!Number.isInteger(count) || count <= 0 || rows.length !== count * 2) return false;
  const keys = new Set();
  for (const row of rows) {
    const key = `${row.pair}:${row.arm}`;
    if (
      !Number.isInteger(row.pair) ||
      row.pair < 0 ||
      row.pair >= count ||
      !["control", "candidate"].includes(row.arm) ||
      keys.has(key)
    )
      return false;
    keys.add(key);
    const samples = lifecycle === "warm" ? protocol.measuredCallsPerWarmProcess : 1;
    const warmups = lifecycle === "warm" ? protocol.warmupCallsPerWarmProcess : 0;
    if (
      row.status !== "completed" ||
      !positive(row.processMs) ||
      !positive(row.resourceUsage?.maxRSS) ||
      !Array.isArray(row.samples) ||
      !Array.isArray(row.warmups) ||
      row.samples.length !== samples ||
      row.warmups.length !== warmups ||
      row.samples.length === 0 ||
      ![...row.samples, ...row.warmups].every(validObservation)
    )
      return false;
  }
  return true;
}

export function qualify(results, protocol, artifactBuildHash, finalBuildHash) {
  const complete =
    ["warm", "cold"].every((lifecycle) => completeLifecycle(results, lifecycle, protocol)) &&
    results.every((r) => ["warm", "cold"].includes(r.lifecycle));
  const observations = results.flatMap((r) => [...(r.samples ?? []), ...(r.warmups ?? [])]);
  const signatures = new Set(
    observations.map((s) => JSON.stringify([s.status, s.planDigest, s.preparedBytes])),
  );
  const semanticParity = complete && signatures.size === 1;
  const recordingBehavior =
    complete &&
    results.every((r) =>
      [...r.samples, ...r.warmups].every(
        (s) => s.recording === (r.arm === "candidate" ? "writer_not_active" : null),
      ),
    );
  const summaries = ["warm", "cold"].map((lifecycle) => {
    if (!completeLifecycle(results, lifecycle, protocol))
      return { lifecycle, passed: false, reason: "incomplete_or_invalid_samples" };
    const pairs = results
      .filter((r) => r.lifecycle === lifecycle && r.arm === "control")
      .map((control) => ({
        control,
        candidate: results.find(
          (r) => r.lifecycle === lifecycle && r.pair === control.pair && r.arm === "candidate",
        ),
      }));
    const average = (r) => r.samples.reduce((sum, s) => sum + s.elapsedMs, 0) / r.samples.length;
    const preparationAddedMs = interval(
      pairs.map(({ control, candidate }) => average(candidate) - average(control)),
    );
    const processTimeRatio = interval(
      pairs.map(({ control, candidate }) => candidate.processMs / control.processMs),
    );
    const peakRssRatio = interval(
      pairs.map(
        ({ control, candidate }) => candidate.resourceUsage.maxRSS / control.resourceUsage.maxRSS,
      ),
    );
    return {
      lifecycle,
      preparationAddedMs,
      processTimeRatio,
      peakRssRatio,
      passed:
        preparationAddedMs.upper95 <= protocol.noninferiority.meanPreparationAddedMsUpper95 &&
        processTimeRatio.upper95 <= protocol.noninferiority.meanProcessTimeRatioUpper95 &&
        peakRssRatio.upper95 <= protocol.noninferiority.meanPeakRssRatioUpper95,
    };
  });
  const unchangedBuild = artifactBuildHash === finalBuildHash;
  const expectedBuild =
    !protocol.expectedArtifactBuildHash || protocol.expectedArtifactBuildHash === artifactBuildHash;
  return {
    unchangedBuild,
    expectedBuild,
    complete,
    semanticParity,
    recordingBehavior,
    summaries,
    qualified:
      complete &&
      unchangedBuild &&
      expectedBuild &&
      semanticParity &&
      recordingBehavior &&
      summaries.every((s) => s.passed),
  };
}
