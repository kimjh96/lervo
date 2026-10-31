import type { RepositoryHealthProjectionV1 } from "@lervo/application-contract";
import type { HealthProjectionSources } from "./repository-health-projection.js";
import { unknownHealthMeasure } from "./repository-health-measure.js";

type Measure = RepositoryHealthProjectionV1["measures"]["freshness"];
const DAY = 86_400_000;
const SOURCES = [
  ".lervo/state/knowledge/document-staleness.json",
  ".lervo/state/knowledge/freshness-cycle.json",
];

function current(at: string | null, now: Date): boolean {
  const elapsed = now.getTime() - Date.parse(at ?? "");
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= DAY;
}

/** Each source survives loss or expiry of the other; neither supplies the other's denominator. */
export function expireHealthFreshness(measure: Measure, now: Date): Measure {
  if (measure.value === null) return measure;
  const v = { ...measure.value };
  const evaluation =
    current(v.evaluationObservedAt, now) &&
    (v.evaluationValidUntil === null || Date.parse(v.evaluationValidUntil) >= now.getTime());
  const cycle =
    current(v.cycleObservedAt, now) &&
    (v.cycleValidUntil === null || Date.parse(v.cycleValidUntil) >= now.getTime());
  if (!evaluation) {
    v.stale = v.evaluated = v.unevaluated = v.unknown = null;
    v.evaluationObservedAt = v.evaluationValidUntil = null;
  }
  if (evaluation)
    v.evaluationValidUntil = new Date(Date.parse(v.evaluationObservedAt!) + DAY).toISOString();
  if (cycle) v.cycleValidUntil = new Date(Date.parse(v.cycleObservedAt!) + DAY).toISOString();
  if (!cycle) {
    v.cycleStale = v.safety = v.awaitingReview = v.refreshed = null;
    v.firstSafetyPath = v.blocked = null;
    v.cycleObservedAt = v.cycleValidUntil = null;
  }
  if (!evaluation && !cycle)
    return unknownHealthMeasure("freshness_sources_missing_or_stale", SOURCES);
  const times = [v.evaluationObservedAt, v.cycleObservedAt].filter(
    (at): at is string => at !== null,
  );
  return {
    value: v,
    observedAt: times.sort().at(-1)!,
    validUntil: new Date(Math.max(...times.map((at) => Date.parse(at) + DAY))).toISOString(),
    source: SOURCES,
    coverage: evaluation && cycle ? "complete" : "partial",
    status:
      [v.stale, v.unevaluated, v.unknown, v.cycleStale, v.safety, v.awaitingReview].some(
        (n) => (n ?? 0) > 0,
      ) || v.blocked === true
        ? "gap"
        : "within_target",
    reason:
      evaluation && cycle
        ? null
        : evaluation
          ? "freshness_cycle_missing_or_stale"
          : "freshness_evaluation_missing_or_stale",
  };
}

export function projectHealthFreshness(input: HealthProjectionSources): Measure {
  const report = input.staleness;
  const evaluation =
    report?.status === "observed" &&
    report.currentRevision === input.headRevision &&
    report.counts &&
    Object.values(report.counts).every((n) => Number.isSafeInteger(n) && n >= 0)
      ? report
      : null;
  const c = input.freshnessCycle;
  const cycle =
    c?.summary &&
    [c.summary.staleCount, c.summary.safetyCount, c.summary.awaitingReviewCount].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    Array.isArray(c.summary.appliedRecentPaths) &&
    typeof c.summary.blocked === "boolean"
      ? c
      : null;
  return expireHealthFreshness(
    {
      ...unknownHealthMeasure("freshness_sources_missing_or_stale", SOURCES),
      value: {
        stale: evaluation?.counts.stale ?? null,
        evaluated: evaluation?.counts.evaluated ?? null,
        unevaluated: evaluation?.counts.unevaluated ?? null,
        unknown: evaluation?.counts.unknown ?? null,
        evaluationObservedAt: evaluation?.evaluatedAt ?? null,
        evaluationValidUntil: null,
        cycleObservedAt: cycle?.lastCycleAt ?? null,
        cycleValidUntil: null,
        cycleStale: cycle?.summary.staleCount ?? null,
        safety: cycle?.summary.safetyCount ?? null,
        firstSafetyPath: cycle?.summary.firstSafetyPath ?? null,
        awaitingReview: cycle?.summary.awaitingReviewCount ?? null,
        refreshed: cycle?.summary.appliedRecentPaths.length ?? null,
        blocked: cycle?.summary.blocked ?? null,
      },
    },
    input.now,
  );
}
