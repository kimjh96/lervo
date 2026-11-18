export const searchUsage = `  lervo search <query> [--root <path>] [--limit <1-50>] [--json]
  lervo search plan activate <bundle-id> --operator <operator-id> [--root <path>] [--json]
  lervo search plan rollback --operator <operator-id> [--root <path>] [--json]
  lervo search plan status [--root <path>] [--json]`;

export function searchErrorCode(error: unknown): string {
  return typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "search_failed";
}

export function searchArgumentError(error: unknown): string {
  return `${error instanceof Error ? error.message : String(error)}\n${searchUsage}\n`;
}
