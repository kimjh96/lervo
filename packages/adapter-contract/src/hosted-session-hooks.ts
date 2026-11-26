// Lervo's hooks for a hosted session (ADR-0613, ADR-0632): the session-scoped settings file with
// the recording handler, and the terminal hooks for events a worktree's own settings lack.

import { isAbsolute } from "node:path";

/** The longest hook command an intent may carry. */
export const MAX_HOOK_COMMAND_CHARACTERS = 1024;

/** The provider events a hosted session's terminal hooks may answer. */
export const HOSTED_TERMINAL_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PreToolUse",
] as const;

/** One provider event the terminal hooks answer, such as `UserPromptSubmit`. */
export interface HostedTerminalHookEvent {
  readonly name: (typeof HOSTED_TERMINAL_HOOK_EVENTS)[number];
  /**
   * Limits a `SessionStart` handler to the sources the worktree's own hooks leave out, such as
   * `resume|compact`, so no source runs Lervo twice; absent, the handler answers every source. A
   * `PreToolUse` handler must name the tools whose writes Lervo claims, such as `Edit|Write`.
   */
  readonly matcher?: string;
}

/** The terminal hook command and the provider events it answers. */
export interface HostedTerminalHooks {
  readonly command: string;
  readonly events: readonly HostedTerminalHookEvent[];
}

/**
 * Lervo's hook handler for a hosted session. Lervo passes it only to an adapter that declares
 * `hooks`, and writes the adapter's settings file before the launch returns.
 */
export interface HostedSessionHooks {
  /** Where Lervo writes the session-scoped settings file: an absolute path. */
  readonly settingsPath: string;
  /** The command line the provider runs at each session event, such as the session's start. */
  readonly command: string;
  /**
   * Lervo's terminal hooks for the provider events the worktree's settings lack, so every hosted
   * session is a Lervo session (ADR-0632). Events Lervo already hooks are left out, so no event
   * runs Lervo twice. An adapter that writes them writes a handler for every listed event.
   */
  readonly terminal?: HostedTerminalHooks;
}

/** Why a hook part of a launch intent is invalid, or null when it is valid. */
export function hostedSessionHooksProblem(hooks: HostedSessionHooks): string | null {
  if (!isAbsolute(hooks.settingsPath)) return "The settings file must be an absolute path.";
  if (!validCommand(hooks.command))
    return "The hook command must be one line of 1 to 1,024 characters.";
  const terminal = hooks.terminal;
  if (terminal === undefined) return null;
  if (!validCommand(terminal.command))
    return "The terminal hook command must be one line of 1 to 1,024 characters.";
  const names = terminal.events.map((event) => event.name);
  if (
    names.length === 0 ||
    new Set(names).size !== names.length ||
    !names.every((name) => (HOSTED_TERMINAL_HOOK_EVENTS as readonly string[]).includes(name))
  )
    return "The terminal hook events must be known, unique, and at least one.";
  for (const event of terminal.events) {
    if (event.name === "PreToolUse") {
      if (
        event.matcher === undefined ||
        !/^[A-Z][A-Za-z]*(?:\|[A-Z][A-Za-z]*){0,7}$/u.test(event.matcher)
      )
        return "A PreToolUse terminal hook takes a matcher of one to eight tool names.";
    } else if (
      event.matcher !== undefined &&
      (event.name !== "SessionStart" || !/^[a-z]+(?:\|[a-z]+){0,7}$/u.test(event.matcher))
    )
      return "Only a SessionStart terminal hook takes a matcher of session sources.";
  }
  return null;
}

function validCommand(command: string): boolean {
  return (
    command.trim().length > 0 &&
    command.length <= MAX_HOOK_COMMAND_CHARACTERS &&
    !/[\r\n]/u.test(command)
  );
}
