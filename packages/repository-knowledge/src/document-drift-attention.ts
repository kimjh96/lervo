import type { KnowledgeLintIssue, KnowledgeLintResult } from "./types.js";

/**
 * Lint codes that become agent-owned `knowledge_lifecycle` attention items (ADR-0464), in the
 * priority order used when a small bound must choose between them.
 */
export const documentDriftAttentionCodes = [
  "entrypoint_reference_missing",
  "document_stale",
  "markdown_link_target_missing",
  "document_role_target_missing",
  "document_staleness_unknown",
  "document_reference_findings_truncated",
] as const;

export const MAXIMUM_DOCUMENT_DRIFT_ATTENTION_ITEMS = 16;

/** The shape of one terminal lifecycle issue; owners derive `actionOwner: "agent"` from it. */
export interface DocumentDriftAttentionIssue {
  code: string;
  command: string;
  detail: string;
}

const attentionCodes = new Set<string>(documentDriftAttentionCodes);
const MAXIMUM_DETAIL_CHARACTERS = 300;

function detail(issue: KnowledgeLintIssue): string {
  const parts = [
    `path=${issue.path}`,
    ...(issue.target === undefined ? [] : [`target=${issue.target}`]),
    ...(issue.reasons === undefined || issue.reasons.length === 0
      ? []
      : [`reasons=${issue.reasons.join(",")}`]),
  ];
  return parts.join(" ").slice(0, MAXIMUM_DETAIL_CHARACTERS);
}

/**
 * Projects document drift lint warnings into bounded, privacy-bounded lifecycle issues: relative
 * paths and reason names only, and one overflow item beyond the bound. Items are taken
 * round-robin across codes in priority order, so one prolific code cannot hide the others.
 * Agents resolve them by updating the owning document through the normal reviewed path; this
 * projection never authorizes a write.
 */
export function documentDriftAttentionIssues(
  lint: Pick<KnowledgeLintResult, "issues">,
  maximumItems = MAXIMUM_DOCUMENT_DRIFT_ATTENTION_ITEMS,
): DocumentDriftAttentionIssue[] {
  const bound = Math.max(1, Math.min(maximumItems, MAXIMUM_DOCUMENT_DRIFT_ATTENTION_ITEMS));
  const relevant = lint.issues.filter((issue) => attentionCodes.has(issue.code));
  const queues = documentDriftAttentionCodes.map((code) =>
    relevant.filter((issue) => issue.code === code),
  );
  const selected: KnowledgeLintIssue[] = [];
  for (let round = 0; selected.length < bound; round += 1) {
    const layer = queues.flatMap((queue) => queue.slice(round, round + 1));
    if (layer.length === 0) break;
    selected.push(...layer.slice(0, bound - selected.length));
  }
  const items = selected.map((issue) => ({
    code: issue.code,
    command: "lervo knowledge lint --json",
    detail: detail(issue),
  }));
  if (relevant.length > items.length)
    items.push({
      code: "document_drift_attention_truncated",
      command: "lervo knowledge lint --json",
      detail: `omitted=${relevant.length - items.length}`,
    });
  return items;
}
