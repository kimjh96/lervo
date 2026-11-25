// ADR-0562 section 4, resident context socket (resident-context-socket.md): the host's context
// server answers a prompt or Stop hook over a Unix socket with exactly what the in-process hook would
// print. The launcher is the client. Nothing here runs before the client commits with `G`, so a turn
// is recorded once: either here, or by the client's in-process fallback, never both.
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { rmSync, statSync } from "node:fs";
import { chmod, rm, stat } from "node:fs/promises";

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

const MAXIMUM_LINE_BYTES = 256 * 1024;
const REQUEST_READ_MILLISECONDS = 1000;
/**
 * Generous on purpose: a client that leaves closes the socket anyway, and a stalled event loop
 * must not drop a `G` that already arrived, which would lose a committed prompt.
 */
const COMMIT_WAIT_MILLISECONDS = 10_000;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export type TerminalContextDecline =
  "runtime_mismatch" | "environment_mismatch" | "busy" | "request_too_large" | "invalid_request";

/** The hooks a server runs, by the provider event each one answers. */
export const TERMINAL_CONTEXT_KINDS = { prompt: "UserPromptSubmit", stop: "Stop" } as const;

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
   * Waits, after the answer went out, for work the hook left running; false when some did not
   * settle in time. The server serves no other request meanwhile.
   */
  drain?: () => Promise<boolean>;
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

export interface TerminalContextServer {
  readonly ready: Promise<void>;
  close(): Promise<void>;
  /**
   * Stops accepting and removes the socket at once, then resolves when the hook in flight, if any,
   * has answered and drained. A Stop that a restart cut off would lose its decision and leave its
   * records half written, which an in-process hook never risks from a Lervo upgrade.
   */
  finish(): Promise<void>;
  /** Removes the socket now, only if it is still the one this server bound. */
  releaseSocket(): void;
}

/**
 * Listens on `socketPath` and serves one request at a time. `run` prepares the prompt as the
 * in-process hook would. After an answer that `overran`, or a run that has not settled within
 * `runLimitMs`, `onOverrun` lets the caller exit, so abandoned work never runs into the next
 * request.
 */
export function startTerminalContextServer(input: {
  socketPath: string;
  runtimeHash: string;
  environment: NodeJS.ProcessEnv;
  run: (request: TerminalContextRequest) => Promise<TerminalContextAnswer>;
  onOverrun?: () => void;
  runLimitMs?: number;
  /** Notes each request's outcome, so a canary can read whether prompts were served. */
  onOutcome?: (
    outcome: "served" | TerminalContextDecline,
    request?: Pick<TerminalContextRequest, "kind" | "launcher">,
  ) => void;
}): TerminalContextServer {
  let bound: { dev: number; ino: number } | null = null;
  const own = effectiveTerminalContextEnvironment(terminalContextEnvironment(input.environment));
  let busy = false;
  let idle: (() => void) | null = null;
  const connections = new Set<Socket>();
  /** Connections the server answered with `A`: their client may already count as committed. */
  const acceptedConnections = new Set<Socket>();
  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.once("close", () => {
      connections.delete(socket);
      acceptedConnections.delete(socket);
    });
    serve(socket);
  });

  function decline(socket: Socket, reason: TerminalContextDecline) {
    input.onOutcome?.(reason);
    socket.end(`${JSON.stringify({ declined: reason })}\n`);
  }

  function serve(socket: Socket) {
    let buffered = Buffer.alloc(0);
    let request: TerminalContextRequest | null = null;
    let committed = false;
    let commitTimer: NodeJS.Timeout | undefined;
    const readTimer = setTimeout(() => socket.destroy(), REQUEST_READ_MILLISECONDS);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(readTimer);
      if (commitTimer !== undefined) clearTimeout(commitTimer);
      // A client that left before committing abandons its request: nothing ran for it.
      if (request !== null && !committed) {
        busy = false;
        idle?.();
      }
    });
    socket.on("data", (chunk: Buffer) => {
      if (request === null) {
        buffered = Buffer.concat([buffered, chunk]);
        const end = buffered.indexOf(0x0a);
        if (end === -1) {
          if (buffered.length > MAXIMUM_LINE_BYTES) {
            clearTimeout(readTimer);
            decline(socket, "request_too_large");
          }
          return;
        }
        clearTimeout(readTimer);
        if (end > MAXIMUM_LINE_BYTES) return decline(socket, "request_too_large");
        const parsed = parseTerminalContextRequest(buffered.subarray(0, end).toString("utf8"));
        const rest = buffered.subarray(end + 1);
        if (parsed === null) return decline(socket, "invalid_request");
        if (parsed.runtime !== input.runtimeHash) return decline(socket, "runtime_mismatch");
        const theirs = effectiveTerminalContextEnvironment(parsed.environment);
        if (TERMINAL_CONTEXT_ENVIRONMENT.some((name) => theirs[name] !== own[name]))
          return decline(socket, "environment_mismatch");
        if (busy) return decline(socket, "busy");
        busy = true;
        request = parsed;
        acceptedConnections.add(socket);
        socket.write("A");
        commitTimer = setTimeout(() => socket.destroy(), COMMIT_WAIT_MILLISECONDS);
        if (rest.length > 0) commit(socket, rest);
        return;
      }
      if (!committed) commit(socket, chunk);
    });

    function commit(socket: Socket, chunk: Buffer) {
      if (chunk[0] !== 0x47 /* G */) return socket.destroy();
      committed = true;
      if (commitTimer !== undefined) clearTimeout(commitTimer);
      input.onOutcome?.("served", request ?? undefined);
      const current = request!;
      // A run that never settles would keep the server busy forever; the caller exits instead.
      const watchdog = setTimeout(() => input.onOverrun?.(), input.runLimitMs ?? 30_000);
      void input
        .run(current)
        .then(
          async (answer) => {
            if (!socket.destroyed)
              socket.end(
                `${JSON.stringify({
                  ok: true,
                  stdout: answer.stdout,
                  stderr: answer.stderr,
                  exitCode: answer.exitCode,
                  launches: answer.launches ?? [],
                })}\n`,
              );
            const drained = (await answer.drain?.()) ?? true;
            return answer.overran || !drained;
          },
          () => {
            // The in-process hook answers an internal failure with an empty context.
            if (!socket.destroyed)
              socket.end(
                `${JSON.stringify({ ok: true, stdout: "{}\n", stderr: "", exitCode: 0 })}\n`,
              );
            return true;
          },
        )
        .then((overran) => {
          clearTimeout(watchdog);
          busy = false;
          idle?.();
          if (overran) input.onOverrun?.();
        });
    }
  }

  const owned = (path: string) => {
    try {
      const current = statSync(path);
      return bound !== null && current.dev === bound.dev && current.ino === bound.ino;
    } catch {
      return false;
    }
  };
  const ready = (async () => {
    // Only the follower that holds the host lock starts a server, and one whose follower died
    // exits when its parent disconnects, so a socket left here belongs to no live server.
    await rm(input.socketPath, { force: true });
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(input.socketPath, () => {
        server.off("error", reject);
        resolveListen();
      });
    });
    await chmod(input.socketPath, 0o600);
    const listening = await stat(input.socketPath);
    bound = { dev: listening.dev, ino: listening.ino };
  })();

  const releaseSocket = () => {
    // Another server may have bound the name since; only this server's socket is removed.
    if (owned(input.socketPath)) rmSync(input.socketPath, { force: true });
  };
  return {
    ready,
    releaseSocket,
    finish: () => {
      server.close();
      releaseSocket();
      // A client counts itself committed once it read `A`, before its `G` arrives, so an accepted
      // connection is kept until it commits or its commit wait ends; any other has nothing to finish.
      for (const socket of connections) if (!acceptedConnections.has(socket)) socket.destroy();
      return busy ? new Promise<void>((resolveIdle) => (idle = resolveIdle)) : Promise.resolve();
    },
    // Closing never waits on a request in flight: its client prints an empty context.
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        for (const socket of connections) socket.destroy();
      }).then(releaseSocket),
  };
}
