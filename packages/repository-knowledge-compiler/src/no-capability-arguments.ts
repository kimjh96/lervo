export function claudeNoCapabilityArguments(): string[] {
  return [
    "--print",
    "--output-format",
    "json",
    "--input-format",
    "text",
    "--tools",
    "",
    "--safe-mode",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--no-chrome",
    "--permission-mode",
    "dontAsk",
  ];
}

export function codexNoCapabilityArguments(): string[] {
  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--json",
    "-c",
    "mcp_servers={}",
  ];
}
