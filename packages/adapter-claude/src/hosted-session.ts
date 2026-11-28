import {
  assertHostedLaunchIntent,
  type HostedStreamDecoding,
  type HostedLaunch,
  type HostedLaunchIntent,
  type HostedModels,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
  type HostedTerminalHooks,
  type HostedTranscriptReading,
  type HostedClaimAnswering,
} from "@lervo/adapter-contract";

import { claudeSignInState } from "./hosted-sign-in.js";
import { ClaudeHostedStreamDecoder } from "./hosted-stream.js";
import { CLAUDE_CLAIM_TOOLS, claudeClaimAnswer, claudeWriteIntent } from "./hosted-claims.js";
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
  readAccess: true,
  questions: true,
};

/**
 * Seconds each hook may take. Claude Code gives `SessionEnd` 1.5 seconds unless a hook names a
 * timeout, and a Lervo handler that starts the CLI and opens the store needs more.
 */
const HOOK_TIMEOUT_SECONDS = 10;

/**
 * The permission mode of a native hosted session, which has no one to answer a permission prompt.
 * The owner chose on 2026-11-26 to run it as their terminal sessions run, without prompts: Claude
 * Code holds a message from a session in another permission mode, so `auto` kept the owner's
 * bypass sessions from reaching hosted ones (Lervo ADE sessions, "Permission mode"). The CLI
 * conversation keeps the owner's own settings, since the owner answers its prompts.
 */
export const CLAUDE_HOSTED_PERMISSION_MODE = "bypassPermissions";

/**
 * A read-access session (Lervo ADE rooms, "Participants and their sessions"): Claude Code refuses
 * every tool these rules do not allow, so the session reads, searches, and answers but changes
 * nothing in the worktree. Git and Lervo run only their reading commands, and Lervo's
 * `workspace start` and `workspace send`, which change no file here: work that needs changes goes to
 * a conversation the agent, or the teammate it hands the work to, leads (ADR-0657).
 */
export const CLAUDE_READ_ACCESS_ARGUMENTS = [
  "--permission-mode",
  "dontAsk",
  "--allowedTools",
  [
    "Read",
    "Grep",
    "Glob",
    "WebFetch",
    "WebSearch",
    "TodoWrite",
    "Bash(git log *)",
    "Bash(git diff *)",
    "Bash(git show *)",
    "Bash(git status *)",
    "Bash(lervo knowledge query *)",
    "Bash(lervo workstream current *)",
    "Bash(lervo workspace start *)",
    "Bash(lervo workspace send *)",
  ].join(","),
] as const;

/**
 * The environment of every hosted session. Auto memory is off: Claude Code would otherwise write
 * the owner's rules and corrections into its own memory, which every worktree of the repository
 * shares with the owner's terminal sessions, while Lervo captures them (AGENTS.md; Lervo ADE
 * sessions, "Provider memory"). It stays off until the Lervo memory tools reach hosted sessions
 * (S2d). Only hosted processes get it; the owner's own settings are untouched.
 */
export const CLAUDE_HOSTED_ENVIRONMENT: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
};

/** Seconds a terminal hook may take, as the project's own terminal hooks allow. */
const TERMINAL_HOOK_TIMEOUT_SECONDS = 30;
/** Seconds a pre-tool claim may hold a tool call: a served answer, then an in-process one. */
const CLAIM_HOOK_TIMEOUT_SECONDS = 60;

/**
 * Claude Code's model aliases by tier. An alias always names the latest model of its line, so a
 * new model needs no change here (`claude --help`, 2026-11-27).
 */
export const claudeHostedModels: HostedModels = {
  frontier: { model: "fable", displayName: "Fable" },
  strong: { model: "opus", displayName: "Opus" },
  balanced: { model: "sonnet", displayName: "Sonnet" },
  fast: { model: "haiku", displayName: "Haiku" },
};

/**
 * The session-scoped settings: Lervo's handler for the session's start and end, which prints
 * nothing because Claude Code adds a `SessionStart` handler's output to the model's context. With
 * `terminal`, Lervo's terminal hooks join for the events the project's settings lack, and their
 * output is the Lervo context the model should receive.
 */
export function claudeSessionSettings(command: string, terminal?: HostedTerminalHooks): string {
  const recording = { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] };
  const hooks: Record<string, unknown[]> = { SessionStart: [recording], SessionEnd: [recording] };
  const terminalCommand = terminal?.command ?? "";
  for (const event of terminal?.events ?? []) {
    const handler = {
      ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
      hooks: [
        event.name === "PreToolUse"
          ? {
              type: "command",
              command: terminal?.claimCommand ?? terminalCommand,
              timeout: CLAIM_HOOK_TIMEOUT_SECONDS,
            }
          : { type: "command", command: terminalCommand, timeout: TERMINAL_HOOK_TIMEOUT_SECONDS },
      ],
    };
    hooks[event.name] = [...(hooks[event.name] ?? []), handler];
  }
  return `${JSON.stringify({ hooks }, null, 2)}\n`;
}

export function createClaudeHostedSessionAdapter(
  executable = "claude",
): HostedSessionAdapter & HostedStreamDecoding & HostedTranscriptReading & HostedClaimAnswering {
  return {
    createStreamDecoder: () => new ClaudeHostedStreamDecoder(),
    readTranscript: (session) => readClaudeTranscript(session),
    provider: "claude",
    displayName: "Claude Code",
    capabilities: claudeHostedCapabilities,
    models: claudeHostedModels,
    claimTools: CLAUDE_CLAIM_TOOLS,
    writeIntent: claudeWriteIntent,
    claimAnswer: claudeClaimAnswer,
    signInState: (environment) => claudeSignInState(executable, environment),
    prepareLaunch(intent: HostedLaunchIntent): HostedLaunch {
      assertHostedLaunchIntent(intent, claudeHostedCapabilities);
      const session =
        intent.start.kind === "new"
          ? ["--session-id", intent.sessionId]
          : ["--resume", intent.sessionId];
      const model = [
        ...(intent.model === undefined ? [] : ["--model", intent.model]),
        ...(intent.effort === undefined ? [] : ["--effort", intent.effort]),
      ];
      const instruction = intent.start.kind === "new" ? intent.start.instruction : null;
      const native = intent.mode === "native";
      const settings = intent.hooks === undefined ? [] : ["--settings", intent.hooks.settingsPath];
      // A read-access session refuses changes in either mode; a native writing session runs
      // without prompts, and the terminal interface asks as the user configured it.
      const access =
        intent.access === "read"
          ? [...CLAUDE_READ_ACCESS_ARGUMENTS]
          : native
            ? ["--permission-mode", CLAUDE_HOSTED_PERMISSION_MODE]
            : [];
      // Asked to, Claude Code sends its questions with choices through the stream, and the
      // decoder answers them, and allows the tools a bypassed session never asks about.
      const questions = intent.questions === true ? ["--permission-prompt-tool", "stdio"] : [];
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
              "--replay-user-messages",
              ...access,
              ...questions,
              ...session,
              ...model,
              ...settings,
            ]
          : [
              ...access,
              ...session,
              ...model,
              ...settings,
              ...(instruction === null ? [] : [instruction]),
            ],
        environment: { ...CLAUDE_HOSTED_ENVIRONMENT },
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
