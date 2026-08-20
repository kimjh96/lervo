export const searchUsage = `  lervo search <query> [--root <path>] [--limit <1-50>] [--json]
  lervo search assess <attempt-id> --outcome <accepted|failed> [--reason <reason>] [--selected <source-kind>:<source-id>] [--expected <source-kind>:<source-id>] [--root <path>] [--json]
  lervo search report [--root <path>] [--json]`;

export function searchErrorCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "search_failed";
}

export function searchArgumentError(error: unknown): string {
  return `${error instanceof Error ? error.message : String(error)}\n${searchUsage}\n`;
}
