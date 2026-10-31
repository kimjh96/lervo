/** Only closed public tool names leave the process adapter; arbitrary provider text stays private. */
export const probeToolNames = [
  "exec",
  "spawn_agent",
  "request_user_input",
  "send_input",
  "wait",
  "close_agent",
  "apply_patch",
  "shell",
  "shell_command",
  "read_file",
  "write_file",
  "web_search",
  "web_fetch",
  "mcp",
  "permission_request",
  "other",
] as const;

export function modelInputToolNames(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown, depth: number): void => {
    if (depth > 12 || item === null || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 128)) visit(child, depth + 1);
      return;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name === "string")
      found.add(
        probeToolNames.includes(record.name as (typeof probeToolNames)[number])
          ? record.name
          : "other",
      );
    for (const child of Object.values(record).slice(0, 128)) visit(child, depth + 1);
  };
  visit(value, 0);
  return [...found].sort().slice(0, 16);
}
