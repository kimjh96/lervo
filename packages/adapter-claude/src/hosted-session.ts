import {
  assertHostedLaunchIntent,
  type HostedStreamDecoding,
  type HostedLaunch,
  type HostedLaunchIntent,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
  type HostedTerminalHooks,
  type HostedTranscriptReading,
} from "@lervo/adapter-contract";

import { ClaudeHostedStreamDecoder } from "./hosted-stream.js";
import { readClaudeTranscript } from "./hosted-transcript.js";

/**
 * Variables an enclosing Claude Code session sets for its children. A hosted session that
 * inherited them would take itself for that session's child: it stops saving its transcript and
 * reaches for the parent's messaging channel. User settings such as `CLAUDE_CODE_USE_BEDROCK` are
 * not markers and pass through.
 */
export const CLAUDE_SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
] as const;

/**
 * Claude Code's hosted sessions, through its documented CLI options. The native conversation runs
 * print mode with structured streams on both sides and partial messages for streaming text; the
 * first instruction arrives through the stream. Print mode cannot ask the user for tool
 * permissions, so it uses Claude Code's `auto` permission mode, as repository work does. The CLI
 * conversation keeps the user's own permission settings.
 *
 * Lervo's hook handlers ride in a session-scoped `--settings` file, which Claude Code merges
 * with the user's settings without changing them. The Lervo MCP server and role instructions
 * arrive with S2, so their capabilities stay false until the launch passes them.
 */
export const claudeHostedCapabilities: HostedSessionCapabilities = {
  nativeConversation: true,
  sessionIdBinding: true,
  hooks: true,
  mcp: false,
  systemPromptFile: false,
  resume: true,
};

/**
 * Seconds each hook may take. Claude Code gives `SessionEnd` 1.5 seconds unless a hook names a
 * timeout, and a Lervo handler that starts the CLI and opens the store needs more.
 */
const HOOK_TIMEOUT_SECONDS = 10;

/** Seconds a terminal hook may take, as the project's own terminal hooks allow. */
const TERMINAL_HOOK_TIMEOUT_SECONDS = 30;

/**
 * The session-scoped settings: Lervo's handler for the session's start and end, which prints
 * nothing because Claude Code adds a `SessionStart` handler's output to the model's context. With
 * `terminal`, Lervo's terminal hooks join for the events the project's settings lack, and their
 * output is the Lervo context the model should receive.
 */
export function claudeSessionSettings(command: string, terminal?: HostedTerminalHooks): string {
  const recording = { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] };
  const hooks: Record<string, unknown[]> = { SessionStart: [recording], SessionEnd: [recording] };
  if (terminal !== undefined) {
    const handler = {
      hooks: [
        { type: "command", command: terminal.command, timeout: TERMINAL_HOOK_TIMEOUT_SECONDS },
      ],
    };
    for (const event of terminal.events) hooks[event] = [...(hooks[event] ?? []), handler];
  }
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

export function createClaudeHostedSessionAdapter(
  executable = "claude",
): HostedSessionAdapter & HostedStreamDecoding & HostedTranscriptReading {
  return {
    createStreamDecoder: () => new ClaudeHostedStreamDecoder(),
    readTranscript: (session) => readClaudeTranscript(session),
    provider: "claude",
    displayName: "Claude Code",
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
      const settings = intent.hooks === undefined ? [] : ["--settings", intent.hooks.settingsPath];
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
              ...settings,
            ]
          : [...session, ...model, ...settings, ...(instruction === null ? [] : [instruction])],
        environment: {},
        workingDirectory: intent.workingDirectory,
        mode: intent.mode,
        initialInput: native ? instruction : null,
        environmentRemove: CLAUDE_SESSION_MARKERS,
        settingsFile:
          intent.hooks === undefined
            ? null
            : {
                path: intent.hooks.settingsPath,
                content: claudeSessionSettings(intent.hooks.command, intent.hooks.terminal),
              },
      };
    },
  };
}
