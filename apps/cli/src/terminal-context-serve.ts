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
 * The stage observation the in-process hook uses, noting whether any stage failed or timed out.
 * A stage's failure rejects only its wrapper; its work may still run, as in a degraded answer that
 * abandoned a sibling stage, so such a request ends the server too.
 */
function observingAbandonedStages(): {
  create: CreateTerminalStageObservation;
  abandoned: () => boolean;
} {
  let abandoned = false;
  const note = <T>(pending: Promise<T>) =>
    pending.catch((error: unknown) => {
      abandoned = true;
      throw error;
    });
  return {
    abandoned: () => abandoned,
    create: (digest) => {
      const port = createTerminalStageObservation(digest);
      // Everything else, deadlines and settling included, comes from the hook's own observation.
      const observed = Object.create(port) as TerminalStageObservationPort;
      Object.assign(observed, {
        measure: (stageId, operation) => note(port.measure(stageId, operation)),
        measureChild: (stageId, parentStageId, operation) =>
          note(port.measureChild(stageId, parentStageId, operation)),
        finalize: (observationId, hook, outcome) => {
          if (outcome !== "completed") abandoned = true;
          return port.finalize(observationId, hook, outcome);
        },
      } satisfies Pick<TerminalStageObservationPort, "measure" | "measureChild" | "finalize">);
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
  const observation = observingAbandonedStages();
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
    overran: observation.abandoned() || performance.now() - startedAt > OVERRUN_MILLISECONDS,
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
