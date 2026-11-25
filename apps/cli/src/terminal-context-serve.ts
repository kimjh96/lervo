// The hook runtime's `context-server` mode: the host's context server process. It runs the same
// verified runtime the launcher would load, so a served prompt and an in-process one run the same
// code by construction.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { TERMINAL_HOOK_BUDGET_MS } from "./terminal-hook-budget.js";
import { runTerminalHookCommand } from "./terminal-hook-command.js";
import {
  startTerminalContextServer,
  TERMINAL_CONTEXT_SOCKET_NAME,
  type TerminalContextAnswer,
  type TerminalContextRequest,
} from "./terminal-context-server.js";
import {
  createTerminalStageObservation,
  type CreateTerminalStageObservation,
  type TerminalStageObservationPort,
} from "./terminal-stage-observation.js";

/** Past this share of the budget, the hook's deadlines fired and abandoned work may still run. */
const OVERRUN_MILLISECONDS = TERMINAL_HOOK_BUDGET_MS / 2;

/**
 * The stage observation the in-process hook uses, also collecting each stage's own work. A stage
 * that fails or reaches its deadline settles its measurement, and a degraded answer goes out, while
 * sibling stages' work may still run; the server waits for that work before the next request.
 */
function trackingStageWork(): {
  create: CreateTerminalStageObservation;
  /** Whether all of it settled within `milliseconds`. */
  drain: (milliseconds: number) => Promise<boolean>;
} {
  const work = new Set<Promise<unknown>>();
  return {
    drain: async (milliseconds) => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<false>((done) => {
        timer = setTimeout(() => done(false), milliseconds);
      });
      const settled = (async () => {
        while (work.size > 0) await Promise.allSettled([...work]);
        return true as const;
      })();
      try {
        return await Promise.race([settled, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    create: (digest) => {
      const port = createTerminalStageObservation(digest);
      // Everything else, deadlines and settling included, comes from the hook's own observation.
      const observed = Object.create(port) as TerminalStageObservationPort;
      observed.trackWork = (pending) => {
        work.add(pending);
        void pending.then(
          () => work.delete(pending),
          () => work.delete(pending),
        );
      };
      return observed;
    },
  };
}

async function runtimeHash(entry: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(dirname(entry), "runtime-v2.json"), "utf8"),
  ) as {
    contentHash?: unknown;
  };
  if (typeof manifest.contentHash !== "string") throw new Error("Runtime manifest is unreadable.");
  return manifest.contentHash;
}

export async function runServedTerminalPrompt(
  request: TerminalContextRequest,
): Promise<TerminalContextAnswer> {
  const startedAt = performance.now() - request.elapsed;
  const observation = trackingStageWork();
  let stdout = "";
  let stderr = "";
  const exitCode = await runTerminalHookCommand(
    request.args,
    {
      cwd: request.cwd,
      stdout: (message) => {
        stdout += message;
      },
      stderr: (message) => {
        stderr += message;
      },
      stdin: async () => request.input,
    },
    { createTerminalStageObservation: observation.create },
    startedAt,
  );
  return {
    stdout,
    stderr,
    exitCode,
    overran: performance.now() - startedAt > OVERRUN_MILLISECONDS,
    // Work a failed or late stage left running settles before the next request, within the rest
    // of the hook's budget; otherwise the server exits.
    drain: () =>
      observation.drain(Math.max(0, startedAt + TERMINAL_HOOK_BUDGET_MS - performance.now())),
  };
}

/**
 * Serves prompts until the process is stopped. The host supervises it: it starts one while it
 * holds the host resident lock, restarts it when it exits, and replaces it when the installed
 * runtime changes.
 */
export async function serveTerminalContext(entry: string): Promise<void> {
  // The runtime lives at `<store>/<runtime directory>/runtime-v2.mjs`. Listening on a name
  // relative to the store keeps the socket path within the platform's limit (about a hundred
  // bytes) however deep the home directory is. Served hooks use the request's directory, never
  // this process's.
  process.chdir(dirname(dirname(entry)));
  // The socket is created owner-only, with no window before its mode is set.
  process.umask(0o077);
  let release = () => undefined as void;
  const server = startTerminalContextServer({
    socketPath: TERMINAL_CONTEXT_SOCKET_NAME,
    runtimeHash: await runtimeHash(entry),
    environment: process.env,
    run: runServedTerminalPrompt,
    // Exit so the host starts a fresh server: abandoned work must not reach the next request.
    onOverrun: () => {
      release();
      process.exit(0);
    },
    runLimitMs: TERMINAL_HOOK_BUDGET_MS + 5000,
  });
  await server.ready;
  release = () => server.releaseSocket();
  // Stop at once, without waiting for a request in flight; its client prints an empty context.
  const stop = () => {
    server.releaseSocket();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  // A server whose host died must not outlive it and serve beside the next host's server.
  if (process.send !== undefined) process.once("disconnect", stop);
  // Keep serving: the listening socket holds the event loop open.
  await new Promise<never>(() => undefined);
}
