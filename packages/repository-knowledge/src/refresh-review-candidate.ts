import { stableId } from "./integrity.js";
import type {
  KnowledgeImpactReport,
  KnowledgeRefreshReviewAction,
  KnowledgeRefreshReviewCandidate,
  KnowledgeRefreshReviewItem,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

function invalid(message: string): never {
  throw new RepositoryKnowledgeError("knowledge_impact_invalid", message);
}

function assertImpactReport(report: KnowledgeImpactReport): void {
  if (
    report.schemaVersion !== 1 || !/^kimpact_[a-f0-9]{24}$/.test(report.reportId) ||
    !/^ksnap_[a-f0-9]{24}$/.test(report.sourceSnapshotId) ||
    typeof report.projectId !== "string" || report.projectId.length === 0 ||
    !Array.isArray(report.items)
  ) invalid("The refresh review candidate has invalid impact report coordinates.");
  const ids = new Set<string>();
  for (const item of report.items) {
    const key = `${item.subjectKind}:${item.subjectId}`;
    if (
      ids.has(key) ||
      !["concept", "claim", "relation"].includes(item.subjectKind) ||
      typeof item.subjectId !== "string" || item.subjectId.length === 0 ||
      !["current", "stale", "unknown"].includes(item.freshness) ||
      !Array.isArray(item.reasons) ||
      item.reasons.some((reason) =>
        !["source_unit_changed", "source_unit_missing", "lineage_unavailable"].includes(reason))
    ) invalid("The refresh review candidate has an invalid impact subject.");
    ids.add(key);
  }
  const summary = {
    current: report.items.filter((item) => item.freshness === "current").length,
    stale: report.items.filter((item) => item.freshness === "stale").length,
    unknown: report.items.filter((item) => item.freshness === "unknown").length,
    affectedConcepts: report.items.filter(
      (item) => item.subjectKind === "concept" && item.freshness === "stale",
    ).length,
  };
  if (
    summary.current !== report.summary.current || summary.stale !== report.summary.stale ||
    summary.unknown !== report.summary.unknown ||
    summary.affectedConcepts !== report.summary.affectedConcepts ||
    stableId("kimpact", {
      projectId: report.projectId,
      sourceSnapshotId: report.sourceSnapshotId,
      status: report.status,
      lineageComplete: report.lineageComplete,
      summary: report.summary,
      items: report.items,
    }) !== report.reportId
  ) invalid("The refresh review candidate impact report ID or summary differs from the source.");
}

function proposedAction(item: KnowledgeImpactReport["items"][number]): KnowledgeRefreshReviewAction {
  if (item.freshness === "unknown") return "resolve_lineage";
  if (item.reasons.includes("source_unit_missing")) return "consider_deprecation";
  return "revalidate";
}

export function createKnowledgeRefreshReviewCandidate(
  report: KnowledgeImpactReport,
): KnowledgeRefreshReviewCandidate {
  assertImpactReport(report);
  const items: KnowledgeRefreshReviewItem[] = report.items
    .filter((item): item is typeof item & { freshness: "stale" | "unknown" } =>
      item.freshness === "stale" || item.freshness === "unknown")
    .map((item) => {
      const action = proposedAction(item);
      return {
        reviewItemId: stableId("krefreshitem", {
          impactReportId: report.reportId,
          subjectKind: item.subjectKind,
          subjectId: item.subjectId,
          observedFreshness: item.freshness,
          reasons: item.reasons,
          proposedAction: action,
        }),
        subjectKind: item.subjectKind,
        subjectId: item.subjectId,
        observedFreshness: item.freshness,
        reasons: [...item.reasons],
        proposedAction: action,
        reviewRequired: true,
      };
    });
  const materials = {
    semantics: "review_candidate" as const,
    projectId: report.projectId,
    sourceSnapshotId: report.sourceSnapshotId,
    impactReportId: report.reportId,
    status: items.length === 0 ? "no_changes" as const : "review_required" as const,
    automaticPublicationMutation: false as const,
    items,
  };
  return {
    schemaVersion: 1,
    candidateId: stableId("krefresh", materials),
    ...materials,
  };
}
