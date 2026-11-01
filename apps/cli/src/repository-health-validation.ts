import type { RepositoryHealthProjectionV1 } from "@lervo/application-contract";

const KEYS = [
  "convergence",
  "longestStop",
  "freshness",
  "ownerReview",
  "deferred",
  "brokenLinks",
  "find",
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 2048;
const time = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const nullable = (value: unknown, valid: (v: unknown) => boolean): boolean =>
  value === null || valid(value);

const rate = (value: unknown): boolean =>
  value === null || (typeof value === "number" && value >= 0 && value <= 1);
function validReplay(value: unknown): boolean {
  return (
    object(value) &&
    time(value.observedAt) &&
    count(value.caseCount) &&
    rate(value.recall) &&
    rate(value.precision)
  );
}

function validValue(key: (typeof KEYS)[number], v: Record<string, unknown>): boolean {
  switch (key) {
    case "convergence":
      return (
        text(v.state) &&
        nullable(v.reason, text) &&
        nullable(v.since, time) &&
        text(v.owner) &&
        text(v.recovery) &&
        nullable(v.residentState, text)
      );
    case "longestStop":
      return (
        nullable(v.since, time) &&
        nullable(v.ageMilliseconds, count) &&
        nullable(v.reportedAt, time) &&
        nullable(v.unreportedMilliseconds, count)
      );
    case "freshness":
      return (
        nullable(v.firstSafetyPath, text) &&
        ["stale", "evaluated", "unevaluated", "unknown"].every((k) => nullable(v[k], count)) &&
        [
          "evaluationObservedAt",
          "evaluationValidUntil",
          "cycleObservedAt",
          "cycleValidUntil",
        ].every((k) => nullable(v[k], time)) &&
        ["cycleStale", "safety", "awaitingReview", "refreshed"].every((k) =>
          nullable(v[k], count),
        ) &&
        nullable(v.blocked, (x) => typeof x === "boolean")
      );
    case "ownerReview":
      return (
        nullable(v.count, count) &&
        count(v.confirmedCount) &&
        count(v.workstreamCount) &&
        count(v.omitted) &&
        nullable(v.upkeepCount, count) &&
        Array.isArray(v.items) &&
        v.items.length <= 32 &&
        v.items.every(
          (i: unknown) =>
            object(i) &&
            text(i.itemId) &&
            text(i.kind) &&
            text(i.actor) &&
            typeof i.requiresUserAction === "boolean" &&
            nullable(i.consequence, text) &&
            (!i.requiresUserAction || i.consequence !== null) &&
            text(i.recommendation) &&
            text(i.inspectCommand) &&
            nullable(i.waitingSince, time) &&
            nullable(i.ageMilliseconds, count),
        )
      );
    case "deferred":
      return (
        count(v.count) &&
        count(v.omitted) &&
        Array.isArray(v.items) &&
        v.items.length <= 32 &&
        v.items.every(
          (i: unknown) =>
            object(i) &&
            text(i.path) &&
            !i.path.startsWith("/") &&
            !i.path.includes("\\") &&
            !i.path.split("/").includes("..") &&
            nullable(i.since, time) &&
            nullable(i.ageMilliseconds, count),
        )
      );
    case "brokenLinks":
      return (
        count(v.count) &&
        [v.missingBacklinkCount, v.orphanCount].every(
          (value) => value === undefined || count(value),
        )
      );
    case "find":
      return (
        time(v.windowStart) &&
        nullable(v.lastInjectedAt, time) &&
        count(v.referencedCount) &&
        count(v.terminalPreparedCount) &&
        [
          v.turnCount,
          v.selectedTurnCount,
          v.pathMentionCount,
          v.governedTurnCount,
          v.missedTurnCount,
        ].every((value) => value === undefined || count(value)) &&
        (v.replay === undefined || v.replay === null || validReplay(v.replay))
      );
  }
}

/** Corrupt private bytes degrade to unknown instead of breaking the availability-safe hook. */
export function validHealthProjection(value: unknown): value is RepositoryHealthProjectionV1 {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "repository_health.projection" ||
    typeof value.repositoryRevision !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.repositoryRevision) ||
    !time(value.observedAt) ||
    !object(value.measures)
  )
    return false;
  const measures = value.measures;
  return KEYS.every((key) => {
    const m = measures[key];
    if (
      !object(m) ||
      !["complete", "partial", "unknown"].includes(String(m.coverage)) ||
      !Array.isArray(m.source) ||
      m.source.length > 8 ||
      !m.source.every(text) ||
      !nullable(m.reason, text)
    )
      return false;
    if (m.status === "unknown")
      return m.value === null && nullable(m.observedAt, time) && nullable(m.validUntil, time);
    return (
      (m.status === "within_target" || m.status === "gap") &&
      time(m.observedAt) &&
      time(m.validUntil) &&
      object(m.value) &&
      validValue(key, m.value)
    );
  });
}
