export const searchUsage = `  lervo search <query> [--root <path>] [--limit <1-50>] [--json]
  lervo search assess <attempt-id> --outcome <accepted|failed> [--reason <reason>] [--selected <source-kind>:<source-id>] [--expected <source-kind>:<source-id>] [--root <path>] [--json]
  lervo search case <attempt-id> --query <reviewed-query-or-managed-task> [--maximum-rank <1-50>] [--match <any|all>] [--root <path>] [--json]
  lervo search bundle create <bundle-id> --role <role-id> --task-type <task-type> --minimum-cases <1-64> [--case <case-id>] [--replace <old-case-id>:<new-case-id>] [--root <path>] [--json]
  lervo search bundle report [bundle-id] [--root <path>] [--json]
  lervo search candidates [--json]
  lervo search compare <bundle-id> --candidate <candidate-id> [--root <path>] [--json]
  lervo search review <comparison-id> --decision <adopt|reject|more-samples> --reviewer <reviewer-id> [--root <path>] [--json]
  lervo search engine policy create --reviewer <reviewer-id> --operator <operator-id> --author <operator-id> --candidate <candidate-id> [--minimum-wins <1-64>] [--root <path>] [--json]
  lervo search engine activate <review-id> --policy <policy-id> --operator <operator-id> [--root <path>] [--json]
  lervo search engine refresh <review-id> --policy <policy-id> --operator <operator-id> [--root <path>] [--json]
  lervo search engine rollback --policy <policy-id> --operator <operator-id> [--root <path>] [--json]
  lervo search engine status [--root <path>] [--json]
  lervo search evaluate [--bundle <bundle-id>] [--root <path>] [--json]
  lervo search report [--root <path>] [--json]`;

export function searchErrorCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "search_failed";
}

export function searchArgumentError(error: unknown): string {
  return `${error instanceof Error ? error.message : String(error)}\n${searchUsage}\n`;
}
