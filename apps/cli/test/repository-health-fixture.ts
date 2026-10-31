import type {
  RepositoryHealthMeasureV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";
import { unknownRepositoryHealth } from "../src/repository-health-reader.js";

export const healthNow = new Date("2026-10-31T02:00:00.000Z");
export const healthRevision = `sha256:${"a".repeat(64)}`;

export function healthyMeasure<T>(value: T): RepositoryHealthMeasureV1<T> {
  return {
    value,
    observedAt: healthNow.toISOString(),
    validUntil: "2026-10-31T02:20:00.000Z",
    source: ["fixture"],
    coverage: "complete",
    status: "within_target",
    reason: null,
  };
}

export function healthyProjection(): RepositoryHealthProjectionV1 {
  const p = unknownRepositoryHealth(healthRevision, healthNow, "fixture");
  p.measures = {
    convergence: healthyMeasure({
      state: "idle",
      reason: null,
      since: null,
      owner: "resident",
      recovery: "next readmission",
      residentState: "idle",
    }),
    longestStop: healthyMeasure({
      since: null,
      ageMilliseconds: 0,
      reportedAt: null,
      unreportedMilliseconds: null,
    }),
    freshness: healthyMeasure({
      stale: 0,
      evaluated: 10,
      unevaluated: 0,
      unknown: 0,
      evaluationObservedAt: healthNow.toISOString(),
      evaluationValidUntil: "2026-11-01T02:00:00.000Z",
      cycleObservedAt: healthNow.toISOString(),
      cycleValidUntil: "2026-11-01T02:00:00.000Z",
      cycleStale: 0,
      safety: 0,
      firstSafetyPath: null,
      awaitingReview: 0,
      refreshed: 0,
      blocked: false,
    }),
    ownerReview: healthyMeasure({
      count: 0,
      confirmedCount: 0,
      workstreamCount: 0,
      items: [],
      omitted: 0,
      upkeepCount: 0,
    }),
    deferred: healthyMeasure({ count: 0, items: [], omitted: 0 }),
    brokenLinks: healthyMeasure({ count: 0 }),
    find: healthyMeasure({
      windowStart: "2026-10-24T02:00:00.000Z",
      lastInjectedAt: healthNow.toISOString(),
      referencedCount: 10,
      terminalPreparedCount: 20,
    }),
  };
  return p;
}
