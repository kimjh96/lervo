import type {
  OperatingAttentionReportV1,
  RepositoryHealthMeasureV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";
import type {
  DocumentStalenessReport,
  KnowledgeConvergenceStatus,
  RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";
import type {
  inspectKnowledgeResidentHealth,
  ConvergenceContinuityState,
} from "@lervo/repository-knowledge-runtime";
import { recordedConvergenceStops, type HealthEventHistory } from "./repository-health-events.js";
import { projectHealthFreshness } from "./repository-health-freshness.js";
import { projectHealthOwnerReview } from "./repository-health-owner-review.js";
import { unknownHealthMeasure } from "./repository-health-measure.js";

const DAY = 86_400_000;
const MAINTENANCE = ".lervo/state/knowledge/maintenance-observation.json";
const EVENTS = ".lervo/data/events.sqlite";

export interface HealthProjectionSources {
  now: Date;
  repositoryRevision: string;
  headRevision: string | null;
  resident: Awaited<ReturnType<typeof inspectKnowledgeResidentHealth>> | null;
  maintenance: { observedAt: string; status: KnowledgeConvergenceStatus } | null;
  continuity: ConvergenceContinuityState | null;
  staleness: DocumentStalenessReport | null;
  freshnessCycle: {
    lastCycleAt: string | null;
    summary: {
      staleCount: number;
      safetyCount: number;
      firstSafetyPath?: string | null;
      awaitingReviewCount: number;
      appliedRecentPaths: string[];
      blocked: boolean;
    };
  } | null;
  captureObservedAt: string | null;
  attention: OperatingAttentionReportV1;
  layout: RepositoryLayoutMigrationPlan | null;
  cachedLifecycle: { issues: Array<{ code: string }> } | null;
  history: HealthEventHistory | null;
}

function observed<T>(
  value: T,
  at: string,
  maxAge: number,
  source: string[],
  gap: boolean,
  now: Date,
): RepositoryHealthMeasureV1<T> {
  const elapsed = now.getTime() - Date.parse(at);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > maxAge)
    return unknownHealthMeasure("source_stale", source);
  return {
    value,
    observedAt: at,
    validUntil: new Date(Date.parse(at) + maxAge).toISOString(),
    source,
    coverage: "complete",
    status: gap ? "gap" : "within_target",
    reason: null,
  };
}

function convergence(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1["measures"]["convergence"] {
  const { maintenance, resident, now } = input;
  const source = [
    MAINTENANCE,
    ".lervo/state/knowledge/resident-health.sqlite",
    EVENTS,
    ".lervo/state/knowledge/convergence-continuity.json",
  ];
  if (maintenance === null || !maintenance.status || typeof maintenance.status.state !== "string")
    return unknownHealthMeasure("maintenance_observation_missing_or_invalid", source);
  if (resident === null || resident.heartbeatAt === null)
    return unknownHealthMeasure("resident_observation_missing", source);
  const heartbeatAge = now.getTime() - Date.parse(resident.heartbeatAt);
  if (!Number.isFinite(heartbeatAge) || heartbeatAge > 120_000 || heartbeatAge < 0)
    return unknownHealthMeasure("resident_observation_stale", source);
  const status = maintenance.status;
  const stopped =
    !["idle", "current", "running"].includes(status.state) ||
    resident.status !== "healthy" ||
    resident.state === "waiting" ||
    resident.state === "attention";
  const open = !input.history?.complete
    ? []
    : recordedConvergenceStops(input.history, now).filter(
        (stop) => stop.until === null && (status.reason === null || stop.reason === status.reason),
      );
  const since =
    open.sort((a, b) => a.since.localeCompare(b.since))[0]?.since ??
    (input.continuity?.continuationFailure?.code === status.reason
      ? input.continuity.continuationFailure.firstObservedAt
      : null);
  const recovery = status.retry?.nextAttemptAt
    ? `retry at ${status.retry.nextAttemptAt}`
    : status.recoveryCommand
      ? `inspect ${status.recoveryCommand}`
      : // No retry or recovery is recorded; say so instead of implying one will happen.
        "none recorded (lervo knowledge convergence status)";
  const measure = observed(
    {
      state: status.state,
      reason: status.reason ?? resident?.reason ?? null,
      since: stopped ? since : null,
      owner: "resident",
      recovery,
      residentState: resident.state,
    },
    maintenance.observedAt,
    20 * 60_000,
    source,
    stopped,
    now,
  );
  if (measure.validUntil !== null)
    measure.validUntil = new Date(
      Math.min(Date.parse(measure.validUntil), Date.parse(resident.heartbeatAt) + 120_000),
    ).toISOString();
  return measure;
}

function longestStop(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1["measures"]["longestStop"] {
  if (input.history === null || !input.history.complete)
    return unknownHealthMeasure("event_history_unavailable_or_bounded", [EVENTS]);
  const stops = recordedConvergenceStops(input.history, input.now);
  const duration = (s: (typeof stops)[number]) =>
    Math.max(0, Date.parse(s.until ?? input.now.toISOString()) - Date.parse(s.since));
  const longest = stops.sort((a, b) => duration(b) - duration(a))[0];
  if (longest === undefined && convergence(input).status !== "within_target")
    return unknownHealthMeasure("stop_start_unrecorded", [EVENTS, MAINTENANCE]);
  const result = observed(
    {
      since: longest?.since ?? null,
      ageMilliseconds: longest === undefined ? 0 : duration(longest),
      reportedAt: null,
      unreportedMilliseconds: null,
    },
    input.now.toISOString(),
    20 * 60_000,
    [EVENTS],
    longest !== undefined,
    input.now,
  );
  if (longest !== undefined) {
    result.coverage = "partial";
    result.reason = "attention_appearance_unrecorded";
  }
  return result;
}

function deferred(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1["measures"]["deferred"] {
  if (input.layout === null)
    return unknownHealthMeasure("document_routes_unavailable", ["repository_layout.plan"]);
  const pending = input.layout.deferredDocuments.filter(
    (d) => d.reason === "semantic_classification_pending",
  );
  const result = observed(
    {
      count: pending.length,
      items: pending
        .slice(0, 32)
        .map((d) => ({ path: d.path, since: null, ageMilliseconds: null })),
      omitted: Math.max(0, pending.length - 32),
    },
    input.now.toISOString(),
    20 * 60_000,
    ["repository_layout.plan"],
    pending.length > 0,
    input.now,
  );
  if (
    pending.length > 0 ||
    input.layout.deferredDocumentCount > input.layout.deferredDocuments.length ||
    !input.layout.coverage.complete
  ) {
    result.coverage = "partial";
    result.reason = "deferral_age_unrecorded_or_coverage_partial";
    if (pending.length === 0)
      return unknownHealthMeasure("document_route_coverage_partial", result.source);
  }
  return result;
}

function find(input: HealthProjectionSources): RepositoryHealthProjectionV1["measures"]["find"] {
  if (input.history === null || !input.history.complete)
    return unknownHealthMeasure("event_history_unavailable_or_bounded", [EVENTS]);
  const start = input.now.getTime() - 7 * DAY;
  const events = input.history.events.filter(
    (e) => Date.parse(e.occurredAt) <= input.now.getTime(),
  );
  const lastInjectedAt =
    events.filter((e) => e.type === "context.injected").at(-1)?.occurredAt ?? null;
  const window = events.filter((e) => Date.parse(e.occurredAt) >= start);
  const value = {
    windowStart: new Date(start).toISOString(),
    lastInjectedAt,
    referencedCount: window.filter((e) => e.type === "context.referenced").length,
    terminalPreparedCount: window.filter((e) => e.type === "terminal.context.prepared").length,
  };
  return observed(
    value,
    input.now.toISOString(),
    20 * 60_000,
    [EVENTS],
    lastInjectedAt === null ||
      Date.parse(lastInjectedAt) < start ||
      value.referencedCount === 0 ||
      value.terminalPreparedCount === 0,
    input.now,
  );
}

/** Pure, host-neutral policy over already recorded state. No provider or lint is a dependency. */
export function projectRepositoryHealth(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1 {
  return {
    schemaVersion: 1,
    kind: "repository_health.projection",
    observedAt: input.now.toISOString(),
    repositoryRevision: input.repositoryRevision,
    measures: {
      convergence: convergence(input),
      longestStop: longestStop(input),
      freshness: projectHealthFreshness(input),
      ownerReview: projectHealthOwnerReview(input),
      deferred: deferred(input),
      // The existing lifecycle cache records only lint validity, not broken-link findings/counts.
      brokenLinks: unknownHealthMeasure(
        input.cachedLifecycle === null
          ? "current_revision_lint_cache_missing"
          : "cached_lint_has_no_link_count",
        [".lervo/state/terminal-integration/knowledge-lifecycle-cache.json"],
      ),
      find: find(input),
    },
  };
}
