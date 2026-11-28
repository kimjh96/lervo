import type {
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
} from "@lervo/application-contract";

import { capContextBytes, MAXIMUM_TERMINAL_ATTENTION_BYTES } from "./terminal-context-budget.js";
import { formatRepositoryHealth } from "./repository-health-format.js";

type AttentionKind = OperatingAttentionItemV1["kind"];
type AttentionOf<K extends AttentionKind> = Extract<OperatingAttentionItemV1, { kind: K }>;

/**
 * One line of detail per attention kind. The record is keyed by every kind, so a new kind fails
 * to compile until it says how it reads, instead of falling through to another kind's fields.
 */
const DESCRIBE: { [K in AttentionKind]: (item: AttentionOf<K>) => string } = {
  workstream_decision: (item) => item.question,
  workstream_approval: (item) => item.summary,
  workstream_blocker: (item) => item.summary,
  canonicalization_review: (item) =>
    `${item.state} · sources ${item.sourcePaths.length} · outcome ${item.outcomeKind ?? "legacy_metadata_only"} · targets ${(item.proposedTargetPaths.length > 0 ? item.proposedTargetPaths : item.recommendedRoots).join(",")}`,
  knowledge_lifecycle: (item) =>
    `${item.issueCode}${item.detail === null ? "" : ` · ${item.detail}`}`,
  repository_replica_divergence: (item) =>
    `replica ${item.replicaId} · ${item.reason} · paths ${item.conflictPathCount}${item.conflictPaths.length === 0 ? "" : ` (${item.conflictPaths.join(",")})`}`,
  document_freshness_candidate: (item) =>
    `${item.state} · ${item.documentPath} · ${item.priorityClass} · ${item.changeClasses.join(",")} · hunks ${item.hunkCount} · ${item.heldReason}`,
  document_freshness_applied: (item) =>
    `${item.state} · ${item.documentPath} · ${item.approvalSource}${item.commitHash === null ? "" : ` · commit ${item.commitHash.slice(0, 12)}`}`,
  document_freshness_blocked: (item) =>
    `${item.state} · ${item.reasonCode}${item.documentPath === null ? "" : ` · ${item.documentPath}`} · attempts ${item.attempts} · since ${item.since} · retry ${item.retryAt}`,
  durable_instruction_candidate: (item) =>
    `${item.captureSource} · ${item.title} · ${item.targetPath}`,
  captured_decision: (item) =>
    `${item.captureSource} · ${item.title} · captured ${item.capturedAt}`,
  instruction_capture_blocked: (item) =>
    `${item.reasonCode} · queued ${item.queuedCount} · since ${item.since}`,
  held_effect: (item) =>
    `${item.effect} · ${item.subject} · ${item.reasonCode} · attempts ${item.attempts} · since ${item.since}`,
  git_index_lock_stale: (item) =>
    `${item.path} · empty · ${Math.floor(item.ageSeconds / 60)} minutes old · since ${item.since}`,
  knowledge_convergence_owner: (item) =>
    `${item.role} · ${item.reason}${item.failureCode === null ? "" : ` · ${item.failureCode}${item.httpStatus === null ? "" : ` HTTP ${item.httpStatus}`}`}${item.holderLabel === null ? "" : ` · holder ${item.holderLabel}`}`,
  knowledge_publication: (item) =>
    `${item.failureCode}${item.detail === null ? "" : ` · ${item.detail}`} · occurrences ${item.occurrences}${item.pullRequestUrl === null ? "" : ` · ${item.pullRequestUrl}`}`,
  knowledge_convergence_continuity: (item) =>
    `${item.severity} · ${item.findingCode}${item.detail === null ? "" : ` · ${item.detail}`}`,
};

function describe<K extends AttentionKind>(item: AttentionOf<K>): string {
  return (DESCRIBE[item.kind] as (value: AttentionOf<K>) => string)(item);
}

export function formatOperatingAttention(report: OperatingAttentionReportV1): string {
  return [
    `Lervo operating attention: ${report.status}`,
    `report: ${report.reportDigest}`,
    `items: ${report.summary.totalCount} · omitted ${report.summary.truncatedCount} · blocking ${report.summary.blockingCount} · user ${report.summary.userActionCount} · stale ${report.summary.staleCount}`,
    `coverage: workstream ${report.coverage.workstream} · canonicalization ${report.coverage.canonicalization} · knowledge ${report.coverage.knowledgeLifecycle}`,
    ...(report.health ? [formatRepositoryHealth(report.health, new Date(report.observedAt))] : []),
    ...report.items.map(
      (item) =>
        `  ${item.kind} ${item.itemId} · owner ${item.attribution?.actor ?? item.actionOwner} · ${describe(item)}\n    ${item.instruction}`,
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
        // ADR-0561: nothing waits for the owner; a missing credential is reported as a notice.
        "Never ask the owner to approve, review, or decide an item: cross-check it, make it reversible, apply it, and report it; mention a missing credential as a notice.",
        "Do not ask the user to run Lervo bookkeeping, and do not treat this prepared projection as receipt or acknowledgment.",
      ].join(" "),
    ].join("\n"),
    MAXIMUM_TERMINAL_ATTENTION_BYTES,
  );
}
