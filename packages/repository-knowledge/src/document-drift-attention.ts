import type { KnowledgeLintIssue, KnowledgeLintResult } from "./types.js";

/** Lint codes that become agent-owned `knowledge_lifecycle` attention items (ADR-0464). */
export const documentDriftAttentionCodes = [
  "document_role_target_missing",
  "markdown_link_target_missing",
  "entrypoint_reference_missing",
  "document_stale",
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
 * paths and reason names only, deterministic order, and one overflow item beyond the bound.
 * Agents resolve them by updating the owning document through the normal reviewed path; this
 * projection never authorizes a write.
 */
export function documentDriftAttentionIssues(
  lint: Pick<KnowledgeLintResult, "issues">,
): DocumentDriftAttentionIssue[] {
  const relevant = lint.issues.filter((issue) => attentionCodes.has(issue.code));
  const items = relevant.slice(0, MAXIMUM_DOCUMENT_DRIFT_ATTENTION_ITEMS).map((issue) => ({
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
