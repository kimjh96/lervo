import type {
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
} from "@lervo/application-contract";

import { capContextBytes, MAXIMUM_TERMINAL_ATTENTION_BYTES } from "./terminal-context-budget.js";

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
  if (item.kind === "document_freshness_candidate")
    return `${item.state} · ${item.documentPath} · ${item.priorityClass} · ${item.changeClasses.join(",")} · hunks ${item.hunkCount}`;
  if (item.kind === "document_freshness_applied")
    return `${item.state} · ${item.documentPath} · ${item.approvalSource}${item.commitHash === null ? "" : ` · commit ${item.commitHash.slice(0, 12)}`}`;
  if (item.kind === "knowledge_convergence_owner")
    return `${item.role} · ${item.reason}${item.failureCode === null ? "" : ` · ${item.failureCode}${item.httpStatus === null ? "" : ` HTTP ${item.httpStatus}`}`}${item.holderLabel === null ? "" : ` · holder ${item.holderLabel}`}`;
  if (item.kind === "knowledge_publication")
    return `${item.failureCode}${item.detail === null ? "" : ` · ${item.detail}`} · occurrences ${item.occurrences}${item.pullRequestUrl === null ? "" : ` · ${item.pullRequestUrl}`}`;
  if (item.kind === "document_freshness_blocked")
    return `${item.reasonCode} · attempts ${item.attempts}`;
  if (item.kind === "durable_instruction_candidate")
    return `${item.captureSource} · ${item.title} · ${item.targetPath}`;
  if (item.kind === "captured_decision")
    return `${item.captureSource} · ${item.title} · captured ${item.capturedAt}`;
  if (item.kind === "instruction_capture_blocked")
    return `${item.reasonCode} · queued ${item.queuedCount} · since ${item.since}`;
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

const WORKSTREAM_KINDS: ReadonlySet<OperatingAttentionItemV1["kind"]> = new Set([
  "workstream_decision",
  "workstream_approval",
  "workstream_blocker",
]);

export function isStaleWorkstreamItem(item: OperatingAttentionItemV1): boolean {
  return WORKSTREAM_KINDS.has(item.kind) && item.state === "stale";
}

export function staleWorkstreamCountLine(count: number): string[] {
  return count === 0
    ? []
    : [`${count} stale workstream items need re-verification: \`lervo workstream current\`.`];
}

/**
 * Retrieval-mode attention context. Stale workstream items are excluded and only counted; the
 * same-turn presentation directive appears only when a listed item is current, user-owned,
 * blocking, and requires user action. The whole section is capped at a fixed byte budget.
 */
export function formatTerminalAttentionContext(report: OperatingAttentionReportV1): string {
  const maximumItems = 12;
  const current = report.items.filter((item) => !isStaleWorkstreamItem(item));
  const staleWorkstreamCount = report.items.length - current.length;
  const selected = current.slice(0, maximumItems);
  const userOwnedBlocking = selected.some(
    (item) => item.actionOwner === "user" && item.requiresUserAction && item.blocking,
  );
  return capContextBytes(
    [
      `Repository attention: ${report.status}; digest: ${report.reportDigest}; items: ${report.summary.totalCount}; omitted: ${report.summary.truncatedCount}; blocking: ${report.summary.blockingCount}; requiresUserAction: ${report.summary.userActionCount}; stale: ${report.summary.staleCount}; canonicalizationCoverage: ${report.coverage.canonicalization}; lifecycleCoverage: ${report.coverage.knowledgeLifecycle}.`,
      ...selected.map(
        (item) =>
          `- ${item.kind}:${item.itemId}; owner=${item.actionOwner}; requiresUserAction=${item.requiresUserAction}; blocking=${item.blocking}; ${describe(item)}`,
      ),
      ...(current.length > maximumItems
        ? [
            `- ${current.length - maximumItems} additional items remain in \`lervo application attention --json\`.`,
          ]
        : []),
      ...staleWorkstreamCountLine(staleWorkstreamCount),
      [
        "Before claiming completion, resolve current agent-owned items that fall within this task.",
        ...(userOwnedBlocking
          ? [
              "For a listed current blocking item with owner=user, present its bounded question or approval in this turn instead of waiting to encounter it incidentally.",
            ]
          : []),
        "Do not infer approval, do not ask the user to run Lervo bookkeeping, and do not treat this prepared projection as receipt or acknowledgment.",
      ].join(" "),
    ].join("\n"),
    MAXIMUM_TERMINAL_ATTENTION_BYTES,
  );
}
