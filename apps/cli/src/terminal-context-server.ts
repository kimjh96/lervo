// ADR-0562 section 4, resident context socket (resident-context-socket.md): the host's context
// server answers a prompt, Stop, or claim hook over a Unix socket with exactly what the in-process
// hook would print. The launcher is the client. Nothing here runs before the client commits with
// `G`, so a turn is recorded once: either here, or by the client's in-process fallback, never both.
import { createServer, type Server, type Socket } from "node:net";
import { rmSync, statSync } from "node:fs";
import { chmod, rm, stat } from "node:fs/promises";

import {
  effectiveTerminalContextEnvironment,
  parseTerminalContextRequest,
  TERMINAL_CONTEXT_ENVIRONMENT,
  terminalContextEnvironment,
  type TerminalContextAnswer,
  type TerminalContextDecline,
  type TerminalContextKind,
  type TerminalContextRequest,
} from "./terminal-context-request.js";

const MAXIMUM_LINE_BYTES = 256 * 1024;
const REQUEST_READ_MILLISECONDS = 1000;
/**
 * Generous on purpose: a client that leaves closes the socket anyway, and a stalled event loop
 * must not drop a `G` that already arrived, which would lose a committed prompt.
 */
const COMMIT_WAIT_MILLISECONDS = 10_000;
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
  /** Whether a request holds the server now, from its acceptance until it drained. */
  busy(): boolean;
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
  /**
   * Notes how long a served hook took to answer, from the client's start to the answer leaving
   * the server, records excluded (ADR-0636).
   */
  onAnswered?: (kind: TerminalContextKind, milliseconds: number) => void;
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
      const committedAt = performance.now();
      const current = request!;
      // A run that never settles would keep the server busy forever; the caller exits instead.
      const watchdog = setTimeout(() => input.onOverrun?.(), input.runLimitMs ?? 30_000);
      void input
        .run(current)
        .then(
          async (answer) => {
            const relayed = answer.pending === true && current.relay === true;
            const line = `${JSON.stringify({
              ok: true,
              stdout: answer.stdout,
              stderr: answer.stderr,
              exitCode: answer.exitCode,
              launches: answer.launches ?? [],
              ...(relayed ? { pending: true } : {}),
            })}\n`;
            if (!socket.destroyed) {
              if (relayed) socket.write(line);
              else socket.end(line);
            }
            input.onAnswered?.(current.kind, current.elapsed + performance.now() - committedAt);
            const drained = (await answer.drain?.()) ?? true;
            // The relay that holds the connection now starts what the records asked for.
            if (relayed && !socket.destroyed)
              socket.end(`${JSON.stringify({ launches: answer.laterLaunches?.() ?? [] })}\n`);
            if (answer.overran || !drained) return true;
            return (await answer.afterDrain?.().catch(() => true)) === false;
          },
          () => {
            // The in-process hook answers an internal failure with an empty context. A claim's
            // failure is no answer, so the launcher decides it in process (ADR-0652).
            if (!socket.destroyed)
              socket.end(
                `${JSON.stringify(
                  current.kind === "tool"
                    ? { ok: false }
                    : { ok: true, stdout: "{}\n", stderr: "", exitCode: 0 },
                )}\n`,
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
    busy: () => busy,
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
