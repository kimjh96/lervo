import type {
  OperatingAttentionReportV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";
import type { HealthProjectionSources } from "./repository-health-projection.js";
import { unknownHealthMeasure } from "./repository-health-measure.js";

const CAPTURE = new Set([
  "durable_instruction_candidate",
  "captured_decision",
  "instruction_capture_blocked",
]);
const CYCLE = new Set([
  "document_freshness_candidate",
  "document_freshness_applied",
  "document_freshness_blocked",
]);
const SOURCE = [
  "operating_attention.report",
  ".lervo/state/knowledge/freshness-cycle.json",
  ".lervo/state/knowledge/instruction-capture/state.json",
];

function current(at: string | null | undefined, now: Date, maxAge: number): boolean {
  const age = now.getTime() - Date.parse(at ?? "");
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}

/** Source currency gates both authority totals and the retained current batch. */
export function projectHealthOwnerReview(
  input: HealthProjectionSources,
): RepositoryHealthProjectionV1["measures"]["ownerReview"] {
  const report = input.attention;
  const capture =
    current(input.captureObservedAt, input.now, 86_400_000) &&
    report.coverage.instructionCapture === "complete";
  const cycle =
    current(input.freshnessCycle?.lastCycleAt, input.now, 86_400_000) &&
    report.coverage.documentFreshness === "complete";
  const sourceCurrent = (kind: string) =>
    CAPTURE.has(kind) ? capture : CYCLE.has(kind) ? cycle : true;
  const items = report.items.filter(
    (item) =>
      sourceCurrent(item.kind) &&
      ((item.kind !== "knowledge_convergence_owner" &&
        item.kind !== "knowledge_convergence_continuity") ||
        current(item.observedAt, input.now, 1_200_000)),
  );
  const complete =
    capture &&
    cycle &&
    report.coverage.workstream !== "unavailable" &&
    report.coverage.canonicalization === "complete" &&
    report.coverage.knowledgeLifecycle !== "unavailable" &&
    report.coverage.knowledgeConvergence === "complete" &&
    ["knowledge_convergence_owner", "knowledge_convergence_continuity"].every(
      (kind) =>
        (report.summary.byKind?.[kind]?.totalCount ?? 0) <=
        items.filter((item) => item.kind === kind).length,
    ) &&
    items.length === report.items.length &&
    (report.summary.truncatedCount === 0 || report.summary.byKind !== undefined);
  const owners = items.flatMap((item) =>
    item.attribution?.requiresUserAction ? [item.attribution] : [],
  );
  const byKind = report.summary.byKind;
  const confirmedCount =
    byKind === undefined
      ? owners.length
      : Object.entries(byKind).reduce((sum, [kind, counts]) => {
          if (!sourceCurrent(kind)) return sum;
          if (kind === "knowledge_convergence_owner" || kind === "knowledge_convergence_continuity")
            return sum + owners.filter((item) => item.kind === kind).length;
          return sum + counts.userActionCount;
        }, 0);
  const workstreamCount =
    report.summary.byKind?.workstream_approval?.userActionCount ??
    owners.filter((item) => item.kind.startsWith("workstream_")).length;
  const upkeep = items.filter(
    (item) => !item.requiresUserAction && item.kind !== "document_freshness_applied",
  ).length;
  if (!complete && confirmedCount === 0 && upkeep === 0)
    return unknownHealthMeasure("owner_review_sources_incomplete", SOURCE);
  return {
    value: {
      count: complete ? confirmedCount : null,
      confirmedCount,
      workstreamCount,
      items: owners.slice(0, 32),
      omitted: Math.max(0, confirmedCount - Math.min(owners.length, 32)),
      upkeepCount: complete
        ? report.summary.totalCount -
          confirmedCount -
          (report.summary.byKind?.document_freshness_applied?.totalCount ?? 0)
        : null,
    },
    observedAt: input.now.toISOString(),
    validUntil: new Date(
      Math.min(
        input.now.getTime() + 1_200_000,
        ...[
          capture ? input.captureObservedAt : null,
          cycle ? input.freshnessCycle?.lastCycleAt : null,
        ].flatMap((at) => (at ? [Date.parse(at) + 86_400_000] : [])),
        ...items.flatMap((item) =>
          (item.kind === "knowledge_convergence_owner" ||
            item.kind === "knowledge_convergence_continuity") &&
          item.observedAt
            ? [Date.parse(item.observedAt) + 1_200_000]
            : [],
        ),
      ),
    ).toISOString(),
    source: SOURCE,
    coverage: complete ? "complete" : "partial",
    status: confirmedCount > 0 || upkeep > 0 ? "gap" : "within_target",
    reason: complete ? null : "owner_review_sources_incomplete",
  };
}

/** Current workstream evidence supersedes cached workstream entries, including resolved approvals. */
export function mergeCurrentOwnerAttention(
  projection: RepositoryHealthProjectionV1,
  attention: OperatingAttentionReportV1,
): RepositoryHealthProjectionV1 {
  const measure = projection.measures.ownerReview;
  const cached = measure.value;
  const current = attention.items.flatMap((item) =>
    item.kind.startsWith("workstream_") && item.attribution?.requiresUserAction
      ? [item.attribution]
      : [],
  );
  const retained = cached?.items.filter((item) => !item.kind.startsWith("workstream_")) ?? [];
  const merged = [
    ...new Map([...current, ...retained].map((item) => [item.itemId, item])).values(),
  ];
  if (current.length === 0 && cached === null) return projection;
  const workstreamCount =
    attention.summary.byKind?.workstream_approval?.userActionCount ?? current.length;
  const confirmedCount =
    (cached === null ? 0 : cached.confirmedCount - cached.workstreamCount) + workstreamCount;
  const complete =
    measure.coverage === "complete" && attention.coverage.workstream !== "unavailable";
  return {
    ...projection,
    measures: {
      ...projection.measures,
      ownerReview: {
        ...measure,
        value: {
          count: complete ? confirmedCount : null,
          confirmedCount,
          workstreamCount,
          items: merged.slice(0, 32),
          omitted: Math.max(0, confirmedCount - Math.min(merged.length, 32)),
          upkeepCount: cached?.upkeepCount ?? null,
        },
        observedAt: attention.observedAt,
        validUntil:
          measure.validUntil ??
          new Date(Date.parse(attention.observedAt) + 1_200_000).toISOString(),
        coverage: complete ? "complete" : "partial",
        status: confirmedCount > 0 || (cached?.upkeepCount ?? 0) > 0 ? "gap" : "within_target",
        reason: complete ? null : "owner_review_sources_incomplete",
      },
    },
  };
}
