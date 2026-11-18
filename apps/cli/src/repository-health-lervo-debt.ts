import type {
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
  RepositoryHealthAttentionV1,
  RepositoryHealthLervoDebtSourceV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";

import type { HealthProjectionSources } from "./repository-health-projection.js";

type Measure = RepositoryHealthProjectionV1["measures"]["lervoDebt"];
type LervoDebt = { source: string; reason: string; since: string | null };

const MAXIMUM_SOURCES = 16;
const MAXIMUM_CREDENTIALS = 8;
const VALIDITY_MS = 20 * 60_000;
const NODE_HEALTH = ".lervo/state/node-runtime-health.json";
const SOURCE = [
  "operating_attention.report",
  ".lervo/state/knowledge/maintenance-observation.json",
];

/** A Node component that holds Lervo debt (ADR-0561): supervision or workstream replication. */
interface HealthNodeDebtComponent {
  status: string;
  reasonCode?: string;
  since?: string;
}

/** The Node health snapshot components the Lervo debt measure reads. */
export interface HealthNodeDebt {
  supervision?: HealthNodeDebtComponent;
  workstreamReplication?: HealthNodeDebtComponent;
}

/**
 * The reason Lervo holds an attention item as its own debt, or null when the item is ordinary
 * work, a notice, or a credential. Reasons are closed codes from structured state, never prose.
 */
export function attentionLervoDebt(item: OperatingAttentionItemV1): LervoDebt | null {
  const since = item.attribution?.waitingSince ?? null;
  const debt = (reason: string): LervoDebt => ({ source: item.kind, reason, since });
  if (item.state !== "lervo_debt") return null;
  switch (item.kind) {
    case "repository_replica_divergence":
      return debt(item.reason);
    case "document_freshness_candidate":
      return debt(item.heldReason);
    case "document_freshness_blocked":
    case "instruction_capture_blocked":
    case "held_effect":
      return debt(item.reasonCode);
    case "captured_decision":
      return debt(item.heldKind);
    case "knowledge_convergence_continuity":
      return debt(item.findingCode);
    case "knowledge_convergence_owner":
      return debt(item.failureCode ?? item.reason);
    case "knowledge_publication":
      return debt(item.failureCode);
    case "canonicalization_review":
      return debt("canonical_review_deferred_repeated");
    case "workstream_approval":
      return debt("recorded_workstream_approval");
  }
  return null;
}

function nodeDebt(
  component: HealthNodeDebtComponent | undefined,
  source: string,
): LervoDebt | null {
  if (component?.status !== "lervo_debt") return null;
  return { source, reason: component.reasonCode ?? "lervo_debt", since: component.since ?? null };
}

function age(since: string | null, now: Date): number | null {
  const elapsed = since === null ? NaN : now.getTime() - Date.parse(since);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

/** Oldest first; an unknown start sorts last because it cannot prove its age. */
function oldestSince(entries: readonly LervoDebt[]): string | null {
  return (
    entries
      .flatMap((entry) => (entry.since === null ? [] : [entry.since]))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
  );
}

function topReason(entries: readonly LervoDebt[]): string | null {
  const counts = new Map<string, { count: number; since: string | null }>();
  for (const entry of entries) {
    const prior = counts.get(entry.reason);
    counts.set(entry.reason, {
      count: (prior?.count ?? 0) + 1,
      since: oldestSince([
        ...(prior === undefined ? [] : [{ ...entry, since: prior.since }]),
        entry,
      ]),
    });
  }
  return (
    [...counts.entries()].sort(
      ([, left], [, right]) =>
        right.count - left.count ||
        Date.parse(left.since ?? "9999") - Date.parse(right.since ?? "9999"),
    )[0]?.[0] ?? null
  );
}

function credentials(report: OperatingAttentionReportV1): RepositoryHealthAttentionV1[] {
  return report.items
    .flatMap((item) =>
      item.attribution?.requiresUserAction && item.attribution.consequence === "credentials"
        ? [item.attribution]
        : [],
    )
    .slice(0, MAXIMUM_CREDENTIALS);
}

function debtMeasure(
  entries: readonly LervoDebt[],
  credentialItems: RepositoryHealthAttentionV1[],
  now: Date,
  complete: boolean,
): Measure {
  const bySource = new Map<string, LervoDebt[]>();
  for (const entry of entries)
    bySource.set(entry.source, [...(bySource.get(entry.source) ?? []), entry]);
  const sources: RepositoryHealthLervoDebtSourceV1[] = [...bySource.entries()]
    .map(([source, group]) => ({
      source,
      count: group.length,
      oldestSince: oldestSince(group),
      reason: topReason(group)!,
    }))
    .sort(
      (left, right) =>
        Date.parse(left.oldestSince ?? "9999") - Date.parse(right.oldestSince ?? "9999") ||
        left.source.localeCompare(right.source),
    )
    .slice(0, MAXIMUM_SOURCES);
  const oldest = oldestSince(entries);
  return {
    value: {
      count: entries.length,
      oldestSince: oldest,
      oldestAgeMilliseconds: age(oldest, now),
      topReason: topReason(entries),
      sources,
      credentials: credentialItems,
    },
    observedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + VALIDITY_MS).toISOString(),
    source: [...SOURCE, NODE_HEALTH],
    coverage: complete ? "complete" : "partial",
    status: entries.length > 0 || credentialItems.length > 0 ? "gap" : "within_target",
    reason: complete ? null : "lervo_debt_sources_incomplete",
  };
}

/**
 * ADR-0561: one measure of everything Lervo holds as its own debt. Attention supplies held
 * freshness, capture, canonicalization, continuity, ownership, publication, replica, effect, and
 * recorded workstream approvals; the maintenance observation supplies parked knowledge sources;
 * the Node health snapshot supplies supervision and workstream replication debt.
 */
export function projectHealthLervoDebt(input: HealthProjectionSources): Measure {
  const report = input.attention;
  const parked =
    input.maintenance?.status.reason === "knowledge_sources_parked"
      ? [
          {
            source: "knowledge_convergence",
            reason: "knowledge_sources_parked",
            since:
              input.continuity?.continuationFailure?.code === "knowledge_sources_parked"
                ? input.continuity.continuationFailure.firstObservedAt
                : null,
          },
        ]
      : [];
  const entries = [
    ...report.items.flatMap((item) => {
      const debt = attentionLervoDebt(item);
      return debt === null ? [] : [debt];
    }),
    ...parked,
    ...[
      nodeDebt(input.nodeHealth?.supervision, "node_supervision"),
      nodeDebt(input.nodeHealth?.workstreamReplication, "node_workstream_replication"),
    ].flatMap((debt) => (debt === null ? [] : [debt])),
  ];
  const complete =
    report.summary.truncatedCount === 0 &&
    report.coverage.workstream !== "unavailable" &&
    report.coverage.canonicalization === "complete" &&
    report.coverage.knowledgeLifecycle !== "unavailable" &&
    report.coverage.documentFreshness !== "unavailable" &&
    report.coverage.instructionCapture !== "unavailable" &&
    report.coverage.knowledgeConvergence !== "unavailable";
  return debtMeasure(entries, credentials(report), input.now, complete);
}

/**
 * Current workstream evidence supersedes the cached projection's workstream debt, so a recorded
 * approval the agent settled since disappears from the terminal line at once.
 */
export function mergeCurrentLervoDebt(
  projection: RepositoryHealthProjectionV1,
  attention: OperatingAttentionReportV1,
): RepositoryHealthProjectionV1 {
  const measure = projection.measures.lervoDebt;
  const cached = measure.value;
  const current = attention.items.flatMap((item) => {
    const debt = item.kind === "workstream_approval" ? attentionLervoDebt(item) : null;
    return debt === null ? [] : [debt];
  });
  const cachedWorkstream = cached?.sources.find((item) => item.source === "workstream_approval");
  const now = new Date(attention.observedAt);
  // Without a usable cache the current workstream debt is still shown, as a partial lower bound.
  if (cached === null)
    return current.length === 0
      ? projection
      : {
          ...projection,
          measures: { ...projection.measures, lervoDebt: debtMeasure(current, [], now, false) },
        };
  if (current.length === 0 && cachedWorkstream === undefined) return projection;
  // Cached sources keep their own count; only the workstream source is replaced.
  const retained = cached.sources
    .filter((item) => item.source !== "workstream_approval")
    .flatMap((item) =>
      Array.from({ length: item.count }, () => ({
        source: item.source,
        reason: item.reason,
        since: item.oldestSince,
      })),
    );
  const merged = debtMeasure(
    [...retained, ...current],
    cached.credentials,
    now,
    measure.coverage === "complete",
  );
  return {
    ...projection,
    measures: {
      ...projection.measures,
      lervoDebt: { ...merged, validUntil: measure.validUntil ?? merged.validUntil },
    },
  };
}
