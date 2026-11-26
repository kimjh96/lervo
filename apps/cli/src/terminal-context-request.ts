// The resident context socket's request protocol (resident-context-socket.md): the kinds of hook
// a request may name, the environment it carries, and how the server reads one line of it. The
// launcher speaks the same protocol from its own file, which cannot import this one.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { DetachedLaunch } from "./detached-knowledge-worker.js";
import {
  validTerminalContextSessionEnvironment,
  type TerminalContextSessionEnvironment,
} from "./terminal-context-session.js";

/** The socket's name inside the terminal hook runtime store, which only this user can enter. */
export const TERMINAL_CONTEXT_SOCKET_NAME = "context.s";

/**
 * Every variable the hook path reads that can change what it prints or records. The server serves
 * a request only when each value equals its own; any other difference declines it.
 */
export const TERMINAL_CONTEXT_ENVIRONMENT = [
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "HOME",
  "LERVO_USER_CAPABILITY_ROOT",
  "LERVO_USER_STATE_DIRECTORY",
  "LERVO_WORKSPACES_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
] as const;

const HASH = /^sha256:[a-f0-9]{64}$/u;

export type TerminalContextDecline =
  "runtime_mismatch" | "environment_mismatch" | "busy" | "request_too_large" | "invalid_request";

/** The hooks a server runs, by the provider event each one answers. */
export const TERMINAL_CONTEXT_KINDS = {
  prompt: "UserPromptSubmit",
  stop: "Stop",
  tool: "PreToolUse",
} as const;

export type TerminalContextKind = keyof typeof TERMINAL_CONTEXT_KINDS;

export interface TerminalContextRequest {
  version: 1;
  kind: TerminalContextKind;
  /** The content hash of the runtime the launcher would have loaded. */
  runtime: string;
  /** The hook's working directory, as the in-process hook would see it. */
  cwd: string;
  args: string[];
  environment: Record<(typeof TERMINAL_CONTEXT_ENVIRONMENT)[number], string | null>;
  /** Milliseconds the client spent before sending. */
  elapsed: number;
  /** The provider's hook input, exactly as read from standard input. */
  input: string;
  /** Which launcher sent it: the host's, or a repository's committed copy. Older clients omit it. */
  launcher?: "host" | "committed";
  /** The session's values the served hook runs with (terminal-context-session.ts). Older clients omit it. */
  session?: TerminalContextSessionEnvironment;
  /** The session's file mode creation mask, which the served hook's writes use. Older clients omit it. */
  umask?: number;
  /**
   * The client hands the connection to a launch relay when an answer is pending (ADR-0636), so
   * launches the records ask for still start in the provider's session. Older clients omit it.
   */
  relay?: true;
}

export interface TerminalContextAnswer {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** The hook reached a deadline: work it abandoned may still be running in this process. */
  overran: boolean;
  /** Detached processes the hook asked for, which its client starts in the provider's session. */
  launches?: DetachedLaunch[];
  /**
   * The answer went out before the hook's records (ADR-0636). For a relaying client, the launches
   * those records ask for follow on a second line once they finish.
   */
  pending?: boolean;
  laterLaunches?: () => DetachedLaunch[];
  /**
   * Waits, after the answer went out, for work the hook left running; false when some did not
   * settle in time. The server serves no other request meanwhile.
   */
  drain?: () => Promise<boolean>;
  /**
   * Runs once the hook drained and its launches went out, while the server stays busy; false when
   * it left work running, which ends the server as an overrun does.
   */
  afterDrain?: () => Promise<boolean>;
}

export function parseTerminalContextRequest(line: string): TerminalContextRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const environment = item.environment as Record<string, unknown> | null;
  if (
    item.version !== 1 ||
    typeof item.kind !== "string" ||
    !Object.hasOwn(TERMINAL_CONTEXT_KINDS, item.kind) ||
    typeof item.runtime !== "string" ||
    !HASH.test(item.runtime) ||
    typeof item.cwd !== "string" ||
    !item.cwd.startsWith("/") ||
    item.cwd.includes("\0") ||
    !Array.isArray(item.args) ||
    item.args.length > 8 ||
    !item.args.every((arg) => typeof arg === "string" && arg.length <= 64) ||
    typeof item.elapsed !== "number" ||
    !Number.isFinite(item.elapsed) ||
    item.elapsed < 0 ||
    typeof item.input !== "string" ||
    (item.launcher !== undefined && item.launcher !== "host" && item.launcher !== "committed") ||
    environment === null ||
    typeof environment !== "object" ||
    Object.keys(environment).sort().join(",") !== [...TERMINAL_CONTEXT_ENVIRONMENT].join(",") ||
    !Object.values(environment).every((entry) => entry === null || typeof entry === "string") ||
    !validTerminalContextSessionEnvironment(item.session) ||
    (item.relay !== undefined && item.relay !== true) ||
    (item.umask !== undefined &&
      (!Number.isInteger(item.umask) ||
        (item.umask as number) < 0 ||
        (item.umask as number) > 0o777))
  )
    return null;
  // A request runs exactly the hook its kind names, so a prompt never reaches the Stop path.
  let event: unknown;
  try {
    event = (JSON.parse(item.input) as { hook_event_name?: unknown } | null)?.hook_event_name;
  } catch {
    return null;
  }
  if (event !== TERMINAL_CONTEXT_KINDS[item.kind as TerminalContextKind]) return null;
  return value as TerminalContextRequest;
}

/**
 * What each variable means for the hook path: an unset variable stands for its default, so a
 * service that sets `LERVO_USER_STATE_DIRECTORY` to the default path matches a session that leaves
 * it unset.
 */
export function effectiveTerminalContextEnvironment(
  environment: TerminalContextRequest["environment"],
  platform: NodeJS.Platform = process.platform,
): TerminalContextRequest["environment"] {
  const home = environment.HOME ?? homedir();
  const stateHome = environment.XDG_STATE_HOME ?? join(home, ".local", "state");
  const userState =
    environment.LERVO_USER_STATE_DIRECTORY !== null &&
    isAbsolute(environment.LERVO_USER_STATE_DIRECTORY)
      ? environment.LERVO_USER_STATE_DIRECTORY
      : platform === "darwin"
        ? join(home, "Library", "Application Support", "Lervo")
        : join(stateHome, "lervo");
  return {
    CLAUDE_CONFIG_DIR: environment.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
    CODEX_HOME: environment.CODEX_HOME ?? join(home, ".codex"),
    HOME: home,
    LERVO_USER_CAPABILITY_ROOT: environment.LERVO_USER_CAPABILITY_ROOT,
    LERVO_USER_STATE_DIRECTORY: userState,
    LERVO_WORKSPACES_HOME: environment.LERVO_WORKSPACES_HOME ?? join(home, ".lervo", "workspaces"),
    XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME ?? join(home, ".config"),
    XDG_STATE_HOME: stateHome,
  };
}

export function terminalContextEnvironment(
  environment: NodeJS.ProcessEnv,
): TerminalContextRequest["environment"] {
  return Object.fromEntries(
    TERMINAL_CONTEXT_ENVIRONMENT.map((name) => [name, environment[name] ?? null]),
  ) as TerminalContextRequest["environment"];
}
