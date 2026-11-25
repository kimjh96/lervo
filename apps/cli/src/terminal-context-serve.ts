// The hook runtime's `context-server` mode: the host's context server process. It runs the same
// verified runtime the launcher would load, so a served hook and an in-process one run the same code
// by construction.
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { handOffDetachedLaunches, type DetachedLaunch } from "./detached-knowledge-worker.js";
import { TERMINAL_HOOK_BUDGET_MS } from "./terminal-hook-budget.js";
import { runTerminalHookCommand } from "./terminal-hook-command.js";
import {
  startTerminalContextServer,
  TERMINAL_CONTEXT_SOCKET_NAME,
  type TerminalContextAnswer,
  type TerminalContextRequest,
} from "./terminal-context-server.js";
import { applyTerminalContextSessionEnvironment } from "./terminal-context-session.js";
import {
  createTerminalStageObservation,
  type CreateTerminalStageObservation,
  type TerminalStageObservationPort,
} from "./terminal-stage-observation.js";

/** How long the server waits for work a prompt left running before it restarts instead. */
const DRAIN_MILLISECONDS = 250;

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

export async function runServedTerminalHook(
  request: TerminalContextRequest,
): Promise<TerminalContextAnswer> {
  const startedAt = performance.now() - request.elapsed;
  const observation = trackingStageWork();
  let stdout = "";
  let stderr = "";
  const launches: DetachedLaunch[] = [];
  // Both last until the hook's leftover work drained: the server serves nothing else meanwhile.
  const restoreEnvironment = applyTerminalContextSessionEnvironment(request.session);
  // The server's own mask keeps its socket private; the hook's files get the session's mode.
  const ownMask = request.umask === undefined ? null : process.umask(request.umask);
  // Only a client that sends its session starts launches; an older one ignores them, so its hook
  // starts them here, as before. After an early answer (ADR-0636) the hook's records continue and a
  // launch they ask for starts here too, with the session's values applied. A launch asked for
  // after the hook finished, by work a deadline abandoned, fails as a failed launch does.
  let phase: "running" | "recording" | "finished" = "running";
  if (request.session !== undefined)
    handOffDetachedLaunches((launch) => {
      if (phase === "finished") return false;
      if (phase === "recording") return null;
      launches.push(launch);
      return true;
    });
  const settle = () => {
    handOffDetachedLaunches(null);
    if (ownMask !== null) process.umask(ownMask);
    restoreEnvironment();
  };
  let early!: (stdout: string) => void;
  const answeredEarly = new Promise<string>((resolve) => (early = resolve));
  const run = runTerminalHookCommand(
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
      answer: (message) => {
        phase = "recording";
        early(message);
      },
    },
    { createTerminalStageObservation: observation.create },
    startedAt,
  ).finally(() => {
    phase = "finished";
  });
  // A run that fails after an early answer is observed by the drain; this branch must not
  // surface it as an unhandled rejection.
  const finishedRun = run.then((exitCode) => ({ exitCode }));
  finishedRun.catch(() => undefined);
  let first: { exitCode: number } | { early: string };
  try {
    first = await Promise.race([
      finishedRun,
      answeredEarly.then((message) => ({ early: message })),
    ]);
  } catch (error) {
    settle();
    throw error;
  }
  const overran = () => performance.now() - startedAt > OVERRUN_MILLISECONDS;
  // Work a failed or late stage left running gets a moment to settle. A server held busy for
  // longer would turn later hooks away; exiting instead lets the host start a fresh one, which it
  // does within a fraction of a second.
  const drainStages = async () => {
    try {
      return await observation.drain(DRAIN_MILLISECONDS);
    } finally {
      settle();
    }
  };
  if ("exitCode" in first)
    return {
      stdout,
      stderr,
      exitCode: first.exitCode,
      overran: overran(),
      launches: [...launches],
      drain: drainStages,
    };
  // Answered before its records: the server stays busy until they finish, then drains.
  return {
    stdout: first.early,
    stderr,
    exitCode: 0,
    overran: false,
    launches: [...launches],
    drain: async () => {
      const finished = await run.then(
        () => true,
        () => false,
      );
      const drained = await drainStages();
      return finished && drained && !overran();
    },
  };
}

/**
 * The server's counts since it started, kept beside its socket so a canary can tell whether
 * prompts were served, and why any were declined. It holds counts and times only.
 */
function contextStats(runtime: string) {
  const stats = {
    schemaVersion: 1,
    runtime,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    served: 0,
    /** Served hooks by the launcher that sent them: the host's or a repository's copy. */
    servedBy: {} as Record<string, number>,
    /** Served hooks by kind: `prompt` or `stop`. */
    servedKinds: {} as Record<string, number>,
    declined: {} as Record<string, number>,
    lastServedAt: null as string | null,
  };
  let writing = Promise.resolve();
  return (outcome: string, request?: { kind: string; launcher?: string | undefined }) => {
    if (outcome === "served") {
      stats.served += 1;
      const by = request?.launcher ?? "unknown";
      stats.servedBy[by] = (stats.servedBy[by] ?? 0) + 1;
      const kind = request?.kind ?? "prompt";
      stats.servedKinds[kind] = (stats.servedKinds[kind] ?? 0) + 1;
      stats.lastServedAt = new Date().toISOString();
    } else stats.declined[outcome] = (stats.declined[outcome] ?? 0) + 1;
    const bytes = `${JSON.stringify(stats)}\n`;
    writing = writing
      .then(async () => {
        // Owner-only whatever mask a served hook applied meanwhile.
        await writeFile(`context-stats.json.${process.pid}.tmp`, bytes, { mode: 0o600 });
        await rename(`context-stats.json.${process.pid}.tmp`, "context-stats.json");
      })
      .catch(() => undefined);
  };
}

/**
 * Serves prompts until the process is stopped. The host's release follower supervises it: it
 * starts one while it holds the follower lock, restarts it when it exits, and replaces it when the
 * installed runtime changes.
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
  const hash = await runtimeHash(entry);
  const server = startTerminalContextServer({
    socketPath: TERMINAL_CONTEXT_SOCKET_NAME,
    runtimeHash: hash,
    onOutcome: contextStats(hash),
    environment: process.env,
    run: runServedTerminalHook,
    // Exit so the host starts a fresh server: abandoned work must not reach the next request.
    onOverrun: () => {
      release();
      process.exit(0);
    },
    runLimitMs: TERMINAL_HOOK_BUDGET_MS + 5000,
  });
  await server.ready;
  release = () => server.releaseSocket();
  // Stop accepting at once, and exit once the hook in flight answered and drained; the watchdog
  // above still bounds a hook that never settles.
  // A service manager signals the server and its follower together, and the follower then signals
  // it again: every later signal must leave the first one's finish running, never kill the hook.
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.finish().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // A server whose host died must not outlive it and serve beside the next host's server.
  if (process.send !== undefined) process.once("disconnect", stop);
  // Keep serving: the listening socket holds the event loop open.
  await new Promise<never>(() => undefined);
}
