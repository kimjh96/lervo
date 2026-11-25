// The host resident supervises the context server (resident-context-socket.md): it runs one while
// it holds the host resident lock, restarts it when it exits, and replaces it when the installed
// terminal hook runtime changes, so a server never outlives an upgrade.
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const FIRST_RESTART_MILLISECONDS = 200;
const LAST_RESTART_MILLISECONDS = 60_000;
/** A server that ran this long before exiting restarts at the first delay again. */
const STABLE_MILLISECONDS = 60_000;
/** A server that ignores SIGTERM this long is killed. */
const TERMINATE_MILLISECONDS = 3000;

export interface TerminalContextRuntime {
  entry: string;
  contentHash: string;
}

/** The runtime the store's pointer names, or null when there is none or it is malformed. */
export async function currentTerminalContextRuntime(
  store: string,
): Promise<TerminalContextRuntime | null> {
  try {
    const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8")) as {
      contentHash?: unknown;
      directory?: unknown;
    };
    if (
      typeof pointer.contentHash !== "string" ||
      !HASH.test(pointer.contentHash) ||
      typeof pointer.directory !== "string" ||
      !/^[a-f0-9]{16}(?:-repair-[a-f0-9]{16})?$/u.test(pointer.directory)
    )
      return null;
    return {
      entry: resolve(store, pointer.directory, "runtime-v2.mjs"),
      contentHash: pointer.contentHash,
    };
  } catch {
    return null;
  }
}

/**
 * Whether the runtime has the server mode. A runtime from before it treats `context-server` as hook
 * arguments and exits at once, as happens for a moment while an upgrade moves the pointer.
 */
async function servesContext(runtime: TerminalContextRuntime): Promise<boolean> {
  try {
    return (await readFile(runtime.entry, "utf8")).includes('"context-server"');
  } catch {
    return false;
  }
}

export interface TerminalContextSupervisor {
  /** Starts the server, or replaces it when the store names another runtime. */
  ensure(): Promise<void>;
  stop(): Promise<void>;
}

export function superviseTerminalContextServer(input: {
  store: string;
  /** Test seam: starts the server process for `runtime`. */
  start?: (runtime: TerminalContextRuntime, store: string) => ChildProcess;
  now?: () => number;
  /** Test seam: whether a runtime has the server mode. */
  supports?: (runtime: TerminalContextRuntime) => Promise<boolean>;
}): TerminalContextSupervisor {
  const supports = input.supports ?? servesContext;
  const supported = new Map<string, boolean>();
  const now = input.now ?? (() => Date.now());
  const start =
    input.start ??
    ((runtime: TerminalContextRuntime, store: string) =>
      spawn(process.execPath, [runtime.entry, "context-server"], {
        cwd: store,
        env: process.env,
        // A crash's trace reaches the host's log; the server never writes a request there. The
        // channel lets the server exit when this host dies.
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      }));
  let child: { process: ChildProcess; runtime: TerminalContextRuntime; startedAt: number } | null =
    null;
  let delay = FIRST_RESTART_MILLISECONDS;
  let restart: NodeJS.Timeout | null = null;
  let stopped = false;

  const launch = (runtime: TerminalContextRuntime) => {
    const server = start(runtime, input.store);
    const current = { process: server, runtime, startedAt: now() };
    child = current;
    server.on("error", () => undefined);
    // `close` also follows a spawn that failed, which emits no `exit`.
    server.once("close", () => {
      if (child !== current) return;
      child = null;
      if (stopped) return;
      // A server that keeps failing backs off; one that served for a while restarts at once.
      delay =
        now() - current.startedAt >= STABLE_MILLISECONDS
          ? FIRST_RESTART_MILLISECONDS
          : Math.min(delay * 2, LAST_RESTART_MILLISECONDS);
      restart = setTimeout(() => {
        restart = null;
        void supervisor.ensure();
      }, delay);
    });
  };

  const terminate = async () => {
    const current = child;
    child = null;
    if (current === null || current.process.exitCode !== null) return;
    await new Promise<void>((done) => {
      const kill = setTimeout(() => current.process.kill("SIGKILL"), TERMINATE_MILLISECONDS);
      current.process.once("close", () => {
        clearTimeout(kill);
        done();
      });
      current.process.kill("SIGTERM");
    });
  };

  const supervisor: TerminalContextSupervisor = {
    async ensure() {
      if (stopped || process.platform === "win32") return;
      const runtime = await currentTerminalContextRuntime(input.store);
      if (child !== null && runtime?.contentHash === child.runtime.contentHash) return;
      await terminate();
      if (runtime === null || stopped || restart !== null) return;
      if (!supported.has(runtime.contentHash))
        supported.set(runtime.contentHash, await supports(runtime));
      if (supported.get(runtime.contentHash) !== true) return;
      launch(runtime);
    },
    async stop() {
      stopped = true;
      if (restart !== null) clearTimeout(restart);
      restart = null;
      await terminate();
    },
  };
  return supervisor;
}
