import type {
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
} from "@lervo/application-contract";

function describe(item: OperatingAttentionItemV1): string {
  if (item.kind === "workstream_decision") return item.question;
  if (item.kind === "workstream_approval") return item.summary;
  if (item.kind === "workstream_blocker") return item.summary;
  if (item.kind === "canonicalization_review") {
    return `${item.state} · sources ${item.sourcePaths.length} · outcome ${item.outcomeKind ?? "legacy_metadata_only"} · targets ${(item.proposedTargetPaths.length > 0 ? item.proposedTargetPaths : item.recommendedRoots).join(",")}`;
  }
  if (item.kind === "repository_replica_divergence") {
    return `replica ${item.replicaId} · ${item.reason} · paths ${item.conflictPathCount}${item.conflictPaths.length === 0 ? "" : ` (${item.conflictPaths.join(",")})`}`;
  }
  return `${item.issueCode}${item.detail === null ? "" : ` · ${item.detail}`}`;
}

export function formatOperatingAttention(report: OperatingAttentionReportV1): string {
  return [
    `Lervo operating attention: ${report.status}`,
    `report: ${report.reportDigest}`,
    `items: ${report.summary.totalCount} · omitted ${report.summary.truncatedCount} · blocking ${report.summary.blockingCount} · user ${report.summary.userActionCount} · stale ${report.summary.staleCount}`,
    `coverage: workstream ${report.coverage.workstream} · canonicalization ${report.coverage.canonicalization} · knowledge ${report.coverage.knowledgeLifecycle}`,
    ...report.items.map(
      (item) =>
        `  ${item.kind} ${item.itemId} · owner ${item.actionOwner} · ${describe(item)}\n    ${item.instruction}`,
    ),
    ...report.limitations.map((limitation) => `  limitation: ${limitation}`),
    "",
  ].join("\n");
}

export function formatTerminalAttentionContext(report: OperatingAttentionReportV1): string {
  const maximumItems = 12;
  const selected = report.items.slice(0, maximumItems);
  return [
    `Repository attention: ${report.status}; digest: ${report.reportDigest}; items: ${report.summary.totalCount}; omitted: ${report.summary.truncatedCount}; blocking: ${report.summary.blockingCount}; requiresUserAction: ${report.summary.userActionCount}; stale: ${report.summary.staleCount}; canonicalizationCoverage: ${report.coverage.canonicalization}; lifecycleCoverage: ${report.coverage.knowledgeLifecycle}.`,
    ...selected.map(
      (item) =>
        `- ${item.kind}:${item.itemId}; owner=${item.actionOwner}; requiresUserAction=${item.requiresUserAction}; blocking=${item.blocking}; ${describe(item)}`,
    ),
    ...(report.items.length > maximumItems
      ? [
          `- ${report.items.length - maximumItems} additional items remain in \`lervo application attention --json\`.`,
        ]
      : []),
    "Before claiming completion, resolve current agent-owned items that fall within this task. If a current blocking item requires user action, present its bounded question or approval in this turn instead of waiting to encounter it incidentally. Do not infer approval, do not ask the user to run Lervo bookkeeping, and do not treat this prepared projection as receipt or acknowledgment.",
  ].join("\n");
}
