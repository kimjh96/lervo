import type {
  OperatingAttentionReportV1,
  RepositoryHealthMeasureV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";
import type {
  DocumentLifecycleSummary,
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
import { projectHealthLervoDebt, type HealthNodeDebt } from "./repository-health-lervo-debt.js";
import { unknownHealthMeasure } from "./repository-health-measure.js";
import type { HealthAppearanceState } from "./repository-health-appearance.js";
import type { LinkWebSummary } from "./link-web-projection.js";

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
  /** ADR-0466 verdict for this host; a non-owner reports the owner's state, not its own past. */
  ownerRole?: {
    role: string;
    holderLabel: string | null;
    holderHostHash?: string | null;
  } | null;
  staleness: DocumentStalenessReport | null;
  /** ADR-0562 shadow lifecycle counts from the lifecycle record, with the HEAD they ran at. */
  lifecycle?: { revision: string; summary: DocumentLifecycleSummary } | null;
  freshnessCycle: {
    lastCycleAt: string | null;
    summary: {
      staleCount: number;
      safetyCount: number;
      firstSafetyPath?: string | null;
      awaitingReviewCount: number;
      appliedRecentPaths: string[];
      blocked: boolean;
      debt?: Array<{ documentPath: string; reason: string; since: string }>;
    };
  } | null;
  captureObservedAt: string | null;
  attention: OperatingAttentionReportV1;
  layout: RepositoryLayoutMigrationPlan | null;
  cachedLifecycle: { issues: Array<{ code: string }> } | null;
  history: HealthEventHistory | null;
  /** ADR-0548 first prepared appearance of each stop in an owner turn. */
  appearance?: HealthAppearanceState | null;
  /** ADR-0551 link web over current Markdown, rebuilt when tracked Markdown changes. */
  linkWeb?: Pick<
    LinkWebSummary,
    "observedAt" | "brokenCount" | "missingBacklinkCount" | "orphanCount" | "truncatedCount"
  > | null;
  /** ADR-0552 seven-day governance check summary. */
  governance?: { governedTurnCount: number; missedTurnCount: number } | null;
  /** ADR-0561 Node components holding Lervo debt; absent or null when no Node health is recorded. */
  nodeHealth?: HealthNodeDebt | null;
  /** ADR-0550 last replay summary over past changes. */
  findReplay?: {
    observedAt: string;
    caseCount: number;
    recall: number | null;
    precision: number | null;
  } | null;
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

const OWNER_PEER_MAXIMUM_AGE_MS = 90 * 60_000;

/**
 * On a Hub host that does not own convergence, local stage records describe an earlier ownership
 * and can show a stop that the owner has long resolved. The measure then reports the owner's last
 * published resident state, or unknown when that observation is missing or old.
 */
function ownerElsewhereConvergence(
  input: HealthProjectionSources,
  source: string[],
): RepositoryHealthProjectionV1["measures"]["convergence"] | null {
  const owner = input.ownerRole;
  if (owner === undefined || owner === null || owner.role === "owner") return null;
  if (!["waiting_owner", "yielding", "contended"].includes(owner.role)) return null;
  // Labels can repeat across hosts; the lease holder's host hash identifies the owner exactly.
  const holderHash = owner.holderHostHash ?? null;
  const peer = input.continuity?.peers.find(
    (item) =>
      item.ownerRole === "owner" &&
      (holderHash !== null
        ? item.hostHash === holderHash
        : owner.holderLabel !== null && item.hostLabel === owner.holderLabel),
  );
  const age = peer === undefined ? NaN : input.now.getTime() - Date.parse(peer.observedAt);
  if (peer === undefined || !Number.isFinite(age) || age < 0 || age > OWNER_PEER_MAXIMUM_AGE_MS)
    return unknownHealthMeasure("owner_observation_missing_or_stale", source);
  // An owner that published no resident state proves nothing about convergence.
  if (
    !["running", "idle", "busy", "waiting", "attention", "stopped"].includes(
      peer.residentState ?? "",
    )
  )
    return unknownHealthMeasure("owner_resident_state_unrecorded", source);
  const stopped = ["attention", "waiting", "stopped"].includes(peer.residentState!);
  return observed(
    {
      state: "owner_elsewhere",
      reason: stopped ? `owner_resident_${peer.residentState}` : null,
      since: null,
      owner: `resident on ${peer.hostLabel ?? owner.holderLabel ?? "the owner host"}`,
      recovery: "the owner host reconciles convergence (lervo knowledge convergence status)",
      residentState: peer.residentState,
    },
    peer.observedAt,
    OWNER_PEER_MAXIMUM_AGE_MS,
    source,
    stopped,
    input.now,
  );
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
  const elsewhere = ownerElsewhereConvergence(input, source);
  if (elsewhere !== null) return elsewhere;
  // ADR-0602: the resident's presence, probed when it was read, proves it runs; the age of its
  // last state write says nothing, since it writes only on change.
  if (resident.status === "not_running")
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
  return measure;
}

const APPEARANCE = ".lervo/state/repository-health-appearance.json";

/**
 * ADR-0548: a stop's first prepared appearance in an owner turn. A stop that began before recording
 * is unknown; a recorded stop never shown so far is unreported for its whole duration.
 */
function stopReporting(
  input: HealthProjectionSources,
  stop: { since: string },
  durationMilliseconds: number,
): { reportedAt: string | null; unreportedMilliseconds: number } | null {
  const appearance = input.appearance ?? null;
  const since = Date.parse(stop.since);
  if (
    appearance === null ||
    since < Date.parse(appearance.recordingSince) ||
    (appearance.prunedThrough != null && since <= Date.parse(appearance.prunedThrough))
  )
    return null;
  const shown = appearance.stops.find((item) => item.since === stop.since);
  if (shown === undefined)
    return { reportedAt: null, unreportedMilliseconds: durationMilliseconds };
  return {
    reportedAt: shown.firstPreparedAt,
    unreportedMilliseconds: Math.max(0, Date.parse(shown.firstPreparedAt) - Date.parse(stop.since)),
  };
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
  const reporting = longest === undefined ? null : stopReporting(input, longest, duration(longest));
  const result = observed(
    {
      since: longest?.since ?? null,
      ageMilliseconds: longest === undefined ? 0 : duration(longest),
      reportedAt: reporting?.reportedAt ?? null,
      unreportedMilliseconds: reporting?.unreportedMilliseconds ?? null,
    },
    input.now.toISOString(),
    20 * 60_000,
    reporting === null ? [EVENTS] : [EVENTS, APPEARANCE],
    longest !== undefined,
    input.now,
  );
  if (longest !== undefined && reporting === null) {
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
  const turns = window
    .filter((e) => e.type === "terminal.turn.observed")
    .map((e) => e.payload as { selectedCount?: unknown; pathMentionCount?: unknown });
  const counted = (value: unknown) =>
    Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : 0;
  const value = {
    windowStart: new Date(start).toISOString(),
    lastInjectedAt,
    referencedCount: window.filter((e) => e.type === "context.referenced").length,
    terminalPreparedCount: window.filter((e) => e.type === "terminal.context.prepared").length,
    turnCount: turns.length,
    selectedTurnCount: turns.filter((turn) => counted(turn.selectedCount) > 0).length,
    pathMentionCount: turns.reduce((sum, turn) => sum + counted(turn.pathMentionCount), 0),
    replay: input.findReplay ?? null,
    ...(input.governance == null ? {} : input.governance),
  };
  // ADR-0550: either channel can prove Find. Managed runs inject and reference documents; compact
  // terminal turns select governing documents and the reply cites them by path.
  const managedProven =
    lastInjectedAt !== null && Date.parse(lastInjectedAt) >= start && value.referencedCount > 0;
  const terminalProven = value.selectedTurnCount > 0 && value.pathMentionCount > 0;
  return observed(
    value,
    input.now.toISOString(),
    20 * 60_000,
    [EVENTS],
    !managedProven && !terminalProven,
    input.now,
  );
}

const LINK_WEB = ".lervo/state/link-web.json";

/**
 * ADR-0551: broken links and missing amendment back-links are gaps; documents without inbound
 * links are reported with them, because an orphan is unconnected knowledge but not an error.
 */
function brokenLinks(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1["measures"]["brokenLinks"] {
  const web = input.linkWeb ?? null;
  if (web === null) return unknownHealthMeasure("link_web_unavailable", [LINK_WEB]);
  const measure = observed(
    {
      count: web.brokenCount,
      missingBacklinkCount: web.missingBacklinkCount,
      orphanCount: web.orphanCount,
    },
    web.observedAt,
    DAY,
    [LINK_WEB],
    web.brokenCount > 0 || web.missingBacklinkCount > 0,
    input.now,
  );
  // A document past the extraction bound may hide links, so counts are a lower bound.
  if ((web.truncatedCount ?? 0) > 0 && measure.value !== null) {
    measure.coverage = "partial";
    measure.reason = "link_extraction_bounded";
  }
  return measure;
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
      lervoDebt: projectHealthLervoDebt(input),
      deferred: deferred(input),
      brokenLinks: brokenLinks(input),
      find: find(input),
    },
  };
}
