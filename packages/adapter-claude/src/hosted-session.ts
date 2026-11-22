import {
  assertHostedLaunchIntent,
  type HostedLaunch,
  type HostedLaunchIntent,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
} from "@lervo/adapter-contract";

/**
 * Claude Code's hosted sessions, through its documented CLI options. The native conversation runs
 * print mode with structured streams on both sides and partial messages for streaming text; the
 * first instruction arrives through the stream. Print mode cannot ask the user for tool
 * permissions, so it uses Claude Code's `auto` permission mode, as repository work does. The CLI
 * conversation keeps the user's own permission settings.
 *
 * Session-scoped hooks, the Lervo MCP server, and role instructions arrive with S1.4c and S2,
 * so their capabilities stay false until the launch passes them.
 */
export const claudeHostedCapabilities: HostedSessionCapabilities = {
  nativeConversation: true,
  sessionIdBinding: true,
  hooks: false,
  mcp: false,
  systemPromptFile: false,
  resume: true,
};

export function createClaudeHostedSessionAdapter(executable = "claude"): HostedSessionAdapter {
  return {
    provider: "claude",
    capabilities: claudeHostedCapabilities,
    prepareLaunch(intent: HostedLaunchIntent): HostedLaunch {
      assertHostedLaunchIntent(intent, claudeHostedCapabilities);
      const session =
        intent.start.kind === "new"
          ? ["--session-id", intent.sessionId]
          : ["--resume", intent.sessionId];
      const model = intent.model === undefined ? [] : ["--model", intent.model];
      const instruction = intent.start.kind === "new" ? intent.start.instruction : null;
      const native = intent.mode === "native";
      return {
        program: executable,
        arguments: native
          ? [
              "--print",
              "--verbose",
              "--input-format",
              "stream-json",
              "--output-format",
              "stream-json",
              "--include-partial-messages",
              "--permission-mode",
              "auto",
              ...session,
              ...model,
            ]
          : [...session, ...model, ...(instruction === null ? [] : [instruction])],
        environment: {},
        workingDirectory: intent.workingDirectory,
        mode: intent.mode,
        initialInput: native ? instruction : null,
      };
    },
  };
}
