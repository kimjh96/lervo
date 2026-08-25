export const searchUsage = `  lervo search <query> [--root <path>] [--limit <1-50>] [--json]
  lervo search benchmark --suite <repository-relative-json> [--root <path>] [--json]
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
  lervo search rollout policy create --reviewer <reviewer-id> --author <reviewer-id> --candidate <candidate-id> [--keep-min-assessments <1-10000>] [--keep-max-failures <0-10000>] [--rollback-min-assessments <1-10000>] [--rollback-min-failures <1-10000>] [--root <path>] [--json]
  lervo search rollout policy check <rollout-review-id> --policy <policy-id> [--root <path>] [--json]
  lervo search rollout review <selection-transition-id> --decision <keep|rollback|more-assessments> --reviewer <reviewer-id> [--policy <policy-id>] [--root <path>] [--json]
  lervo search rollout status [--limit <1-50>] [--cursor <rollout-review-id>] [--root <path>] [--json]
  lervo search rollout action policy create --review-policy <policy-id> --action <keep|rollback> --operator <operator-id> --author <operator-id> [--engine-policy <policy-id>] [--root <path>] [--json]
  lervo search rollout action apply <rollout-review-id> --action <keep|rollback> --policy <action-policy-id> --operator <operator-id> [--root <path>] [--json]
  lervo search rollout action check <rollout-review-id> --action <keep|rollback> --policy <action-policy-id> --operator <operator-id> [--root <path>] [--json]
  lervo search rollout action status [--limit <1-50>] [--cursor <action-id>] [--root <path>] [--json]
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

export function searchPageLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("limit must be an integer between 1 and 50.");
  const limit = Number(value);
  if (limit > 50) throw new Error("limit must be an integer between 1 and 50.");
  return limit;
}
