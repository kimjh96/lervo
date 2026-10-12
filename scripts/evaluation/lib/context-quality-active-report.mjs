import { interval } from "./context-quality-performance-report.mjs";
const finite = (n) => Number.isFinite(n) && n >= 0;
const average = (row, column) =>
  row.samples.reduce((sum, sample) => sum + sample[column], 0) / row.samples.length;

export function qualifyActive(rows, protocol, unchangedBuild) {
  // Each sample must durably commit at least once; only that one required commit is allowed.
  const allowance = protocol.gates.durableCommitAllowanceMs;
  const groups = [];
  for (const profile of protocol.profiles)
    for (const [workload, pairs] of Object.entries(protocol.pairs)) {
      const group = rows.filter((r) => r.profile === profile && r.workload === workload);
      const keys = new Set(group.map((r) => `${r.pair}:${r.arm}`));
      const expectedSamples = workload === "cold" ? 1 : protocol.samples;
      const expectedWarmups = workload === "cold" ? 0 : protocol.warmups;
      const complete =
        group.length === pairs * 2 &&
        keys.size === pairs * 2 &&
        group.every(
          (r) =>
            Number.isInteger(r.pair) &&
            r.pair >= 0 &&
            r.pair < pairs &&
            ["control", "candidate"].includes(r.arm) &&
            r.status === "completed" &&
            finite(r.processMs) &&
            r.processMs > 0 &&
            finite(r.resourceUsage?.maxRSS) &&
            r.resourceUsage.maxRSS > 0 &&
            (allowance === undefined || Number.isSafeInteger(r.durableCommits)) &&
            r.samples?.length === expectedSamples &&
            r.warmups?.length === expectedWarmups &&
            [...r.samples, ...r.warmups].every(
              (sample) =>
                sample.length === 10 &&
                sample.slice(0, 9).every(finite) &&
                sample[1] > 0 &&
                sample[8] === (workload === "concurrent" ? protocol.concurrency : 1) &&
                /^sha256:[a-f0-9]{64}$/u.test(sample[9]),
            ),
        );
      if (!complete) {
        groups.push({ profile, workload, passed: false, reason: "incomplete_or_invalid_samples" });
        continue;
      }
      const paired = group
        .filter((r) => r.arm === "control")
        .map((control) => ({
          control,
          candidate: group.find((r) => r.arm === "candidate" && r.pair === control.pair),
        }));
      const parity = paired.every(
        ({ control, candidate }) =>
          JSON.stringify([...control.warmups, ...control.samples].map((s) => s.slice(6))) ===
          JSON.stringify([...candidate.warmups, ...candidate.samples].map((s) => s.slice(6))),
      );
      const evidence = group.every(
        (r) =>
          r.semanticValid &&
          r.staleSourceRejected &&
          r.integrity &&
          r.eventCount === r.expectedEventCount &&
          r.eventCount ===
            (r.arm === "candidate"
              ? (expectedSamples + expectedWarmups) *
                (workload === "concurrent" ? protocol.concurrency : 1) *
                2
              : 0) &&
          (allowance === undefined ||
            (r.arm === "candidate"
              ? r.durableCommits >= expectedSamples + expectedWarmups
              : r.durableCommits === 0)),
      );
      const rawAddedMs = paired.map(
        ({ control, candidate }) => average(candidate, 0) - average(control, 0),
      );
      const rawProcessRatios = paired.map(
        ({ control, candidate }) => candidate.processMs / control.processMs,
      );
      const elapsedAddedMs = interval(
        allowance === undefined ? rawAddedMs : rawAddedMs.map((added) => added - allowance),
      );
      const processRatio = interval(
        allowance === undefined
          ? rawProcessRatios
          : paired.map(
              ({ control, candidate }) =>
                (candidate.processMs - allowance * (expectedSamples + expectedWarmups)) /
                control.processMs,
            ),
      );
      const rssRatio = interval(
        paired.map(
          ({ control, candidate }) => candidate.resourceUsage.maxRSS / control.resourceUsage.maxRSS,
        ),
      );
      const cpuRatio = interval(
        paired.map(({ control, candidate }) => average(candidate, 1) / average(control, 1)),
      );
      const storagePerRequest = paired.map(
        ({ candidate }) => candidate.stateGrowthBytes / (candidate.expectedEventCount / 2),
      );
      const storageBounded = storagePerRequest.every(
        (n) => finite(n) && n <= protocol.gates.maximumStateBytesPerRequest,
      );
      groups.push({
        profile,
        workload,
        parity,
        evidence,
        elapsedAddedMs,
        processRatio,
        rssRatio,
        cpuRatio,
        ...(allowance === undefined
          ? {}
          : {
              rawElapsedAddedMs: interval(rawAddedMs),
              rawProcessRatio: interval(rawProcessRatios),
            }),
        maximumStateBytesPerRequest: Math.max(...storagePerRequest),
        storageBounded,
        passed:
          parity &&
          evidence &&
          storageBounded &&
          elapsedAddedMs.upper95 <= protocol.gates.meanAddedMsUpper95 &&
          processRatio.upper95 <= protocol.gates.processRatioUpper95 &&
          rssRatio.upper95 <= protocol.gates.rssRatioUpper95 &&
          cpuRatio.upper95 <= protocol.gates.cpuRatioUpper95,
      });
    }
  const exactPopulation =
    rows.length ===
    protocol.profiles.length * Object.values(protocol.pairs).reduce((a, b) => a + b, 0) * 2;
  return {
    unchangedBuild,
    exactPopulation,
    passed: unchangedBuild && exactPopulation && groups.every((g) => g.passed),
    groups,
  };
}
