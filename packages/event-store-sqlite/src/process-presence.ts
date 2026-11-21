import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readlinkSync, rmSync, statSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { WINDOWS } from "./change-channel-layout.js";
import {
  kernelRelation,
  localBootKey,
  localHostKey,
  userStateDirectory,
} from "./process-identity.js";

/**
 * ADR-0602 step 3: a process proves it lives by listening, never by rewriting a heartbeat. Its
 * presence is a local socket in this user's owner-only presence directory (a named pipe on
 * Windows) that only a live listener accepts on. A probe connects and hangs up. A waiter keeps a
 * connection open, and the kernel closes it the moment the holder exits or releases, so it waits
 * for that with no timer. A byte sent over a connection wakes the holder. A holder whose event
 * loop is stuck still exists, so a probe proves the process, not its progress; stalled work is
 * the event channel's stall finding.
 */
export interface HeldProcessPresence {
  /** `<host>-<boot>-<pid>-<nonce>-<namespace>`, recorded where readers look for this process. */
  readonly token: string;
  /** Settles once the presence is listening, or could not be. */
  readonly ready: Promise<void>;
  /** Why it could not be held; null while held or not yet settled. Record the token only when null. */
  issue(): string | null;
  release(): void;
}

export type ProcessPresenceProbe = "alive" | "gone" | "unknown";

/** Unix socket paths are limited to about a hundred bytes (104 on macOS), so names stay short. */
const MAXIMUM_SOCKET_PATH_BYTES = 100;
const TOKEN =
  /^([0-9a-f]{12}|unknown)-(b[0-9a-f]{12}|t[0-9]+|unknown)-([0-9]+)-([0-9a-f]{16})-([0-9a-f]{12})$/u;

/**
 * Where presence sockets live for this user: the private user state directory, which no
 * temporary-file cleaner touches. A state directory too deep for a socket path is replaced by a
 * short owner-only directory under the home directory, named by its hash. The directory is
 * created whenever a presence is held and never removed, since tokens name it by its inode; it
 * is refused unless it is this user's and no one else can enter it.
 */
export function processPresenceDirectory(): string {
  const state = userStateDirectory();
  const preferred = join(state, "run", "presence");
  if (
    WINDOWS ||
    Buffer.byteLength(join(preferred, `${"0".repeat(16)}.s`)) <= MAXIMUM_SOCKET_PATH_BYTES
  )
    return preferred;
  return join(fallbackRoot(), createHash("sha256").update(state).digest("hex").slice(0, 12));
}

function fallbackRoot(): string {
  return join(homedir(), ".lervo-presence");
}

function namespaceInode(kind: "net" | "pid"): string {
  try {
    return readlinkSync(`/proc/self/ns/${kind}`);
  } catch {
    return "none";
  }
}

/**
 * Which processes can reach the same socket and the same pids: the network and pid namespaces and
 * the presence directory, by its device and inode rather than its path, so a process that sees the
 * same path on another filesystem (a container sharing the host's pids and network) never takes
 * another directory's missing socket for a gone holder. A token of another namespace or directory
 * is unknown here, never gone, since a probe from here cannot reach it. A directory that does not
 * exist yet has its own key, which no holder has.
 */
function namespaceKey(directory: string): string {
  let place = "missing";
  try {
    const stats = statSync(directory, { bigint: true });
    place = `${stats.dev}:${stats.ino}`;
  } catch {
    // Missing or unreadable: matches no holder's key.
  }
  return createHash("sha256")
    .update(`${namespaceInode("net")}\0${namespaceInode("pid")}\0${place}`)
    .digest("hex")
    .slice(0, 12);
}

interface ParsedToken {
  host: string;
  boot: string;
  pid: number;
  nonce: string;
  namespace: string;
}

function parse(token: string): ParsedToken | null {
  const match = TOKEN.exec(token);
  return match === null
    ? null
    : {
        host: match[1]!,
        boot: match[2]!,
        pid: Number(match[3]),
        nonce: match[4]!,
        namespace: match[5]!,
      };
}

function socketPath(directory: string, nonce: string): string {
  return WINDOWS ? `\\\\.\\pipe\\lervo-presence-${nonce}` : join(directory, `${nonce}.s`);
}

/** A directory of this user that no one else can enter, created if missing; why not otherwise. */
export function ownedPresenceDirectory(directory: string): string | null {
  if (WINDOWS) return null;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stats = lstatSync(directory);
    const uid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
    if (!stats.isDirectory() || stats.uid !== uid || (stats.mode & 0o077) !== 0)
      return `${directory} must be a directory of this user that no one else can enter.`;
    return null;
  } catch (error) {
    return `${directory} cannot be prepared: ${String(error)}`;
  }
}

/**
 * Holds this process's presence until `release`. `onWake` runs for every byte a peer sends.
 * A presence that cannot be held is reported through `issue`; its token must then not be
 * recorded, so readers fall back to what they knew before.
 */
export function holdProcessPresence(
  options: { onWake?: () => void; directory?: string } = {},
): HeldProcessPresence {
  const directory = options.directory ?? processPresenceDirectory();
  const nonce = randomBytes(8).toString("hex");
  // Prepared first, so the token names the directory it listens in by its device and inode.
  const refused = WINDOWS ? null : ownedPresenceDirectory(directory);
  const token = `${localHostKey()}-${localBootKey()}-${process.pid}-${nonce}-${namespaceKey(directory)}`;
  const path = socketPath(directory, nonce);
  let problem: string | null = null;
  let released = false;
  const connections = new Set<Socket>();
  let server: Server | null = null;
  const ready = new Promise<void>((resolveReady) => {
    if (!WINDOWS && Buffer.byteLength(path) > MAXIMUM_SOCKET_PATH_BYTES) {
      problem = `${path} is longer than a local socket path may be.`;
      return resolveReady();
    }
    problem = refused;
    if (problem !== null) return resolveReady();
    let retried = false;
    const listening = createServer((socket) => {
      if (released) return void socket.destroy();
      connections.add(socket);
      // Held connections never keep the process alive.
      socket.unref();
      socket.on("data", () => options.onWake?.());
      socket.on("error", () => undefined);
      socket.on("close", () => connections.delete(socket));
    });
    listening.unref();
    listening.on("error", (error) => {
      // The directory was removed just now: prepare it again once. The new directory has another
      // inode than the token names, so readers judge this presence unknown (and by its pid), never
      // gone.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !retried) {
        retried = true;
        problem = ownedPresenceDirectory(directory);
        if (problem === null) return void listening.listen(path);
      } else problem = `${path} cannot be listened on: ${String(error)}`;
      resolveReady();
    });
    listening.once("listening", () => {
      server = listening;
      resolveReady();
    });
    listening.listen(path);
  });
  return {
    token,
    ready,
    issue: () => problem,
    release: () => {
      if (released) return;
      released = true;
      // Closing every connection is what each waiter sees as the release.
      for (const socket of connections) socket.destroy();
      void ready.then(() => {
        for (const socket of connections) socket.destroy();
        // The directory stays: tokens name it by its inode, which a new one would not have.
        server?.close();
      });
    },
  };
}

/** Whether a process id lives, from this pid namespace: the confirmation a socket cannot give. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Where to reach a token from here, or why it cannot be judged here. */
function reach(
  token: string,
  directory: string,
): { kind: "reach"; parsed: ParsedToken; path: string } | { kind: "gone" } | { kind: "unknown" } {
  const parsed = parse(token);
  if (parsed === null) return { kind: "unknown" };
  const kernel = kernelRelation(parsed.host, parsed.boot);
  if (kernel === "other_boot") return { kind: "gone" };
  if (kernel !== "same_kernel" || parsed.namespace !== namespaceKey(directory))
    return { kind: "unknown" };
  return { kind: "reach", parsed, path: socketPath(directory, parsed.nonce) };
}

/**
 * What a failed connection to a reachable presence proves. ENOENT: nothing listens there.
 * ECONNRESET or EPIPE: the listener closed with this connection pending or open, which is its
 * release or exit (Linux resets a connection still in the backlog). On Linux ECONNREFUSED means
 * nothing listens too, since a full backlog answers EAGAIN there; elsewhere (macOS) a full listen
 * backlog (a blocked event loop) refuses as well, so a refusal is gone only once the pid is gone.
 * Anything else (EMFILE, EAGAIN) proves nothing.
 */
export function connectionVerdict(
  code: string | undefined,
  platform: NodeJS.Platform,
  pidLives: () => boolean,
): ProcessPresenceProbe {
  if (code === "ENOENT" || code === "ECONNRESET" || code === "EPIPE") return "gone";
  if (code === "ECONNREFUSED") return platform !== "linux" && pidLives() ? "alive" : "gone";
  return "unknown";
}

function failedConnection(error: unknown, parsed: ParsedToken): ProcessPresenceProbe {
  return connectionVerdict((error as NodeJS.ErrnoException | null)?.code, process.platform, () =>
    pidAlive(parsed.pid),
  );
}

/**
 * Refusals in a row from a live pid after which an exit wait reports them: a process stuck that
 * long, or a stale socket whose pid was reused, needs a look.
 */
const EXIT_WAIT_REFUSALS_REPORTED = 3;

/** Removes a socket file no listener holds, so presence files never accumulate. */
function sweep(path: string): void {
  if (!WINDOWS) rmSync(path, { force: true });
}

/**
 * Whether the process holding `token` lives. `gone` is proven by this kernel: nothing listens on
 * its socket and its process is gone, or it belongs to a previous boot. `unknown` means this host,
 * namespace or presence directory cannot judge it.
 */
export function probeProcessPresence(
  token: string,
  options: { directory?: string } = {},
): Promise<ProcessPresenceProbe> {
  const target = reach(token, options.directory ?? processPresenceDirectory());
  if (target.kind !== "reach") return Promise.resolve(target.kind);
  return new Promise((resolveProbe) => {
    const socket = connect(target.path);
    socket.once("connect", () => {
      socket.destroy();
      resolveProbe("alive");
    });
    socket.once("error", (error) => {
      const verdict = failedConnection(error, target.parsed);
      if (verdict === "gone") sweep(target.path);
      resolveProbe(verdict);
    });
  });
}

/** Wakes the process holding `token`; resolves whether it was reached. Never waits on it. */
export function wakeProcessPresence(
  token: string,
  options: { directory?: string } = {},
): Promise<boolean> {
  const target = reach(token, options.directory ?? processPresenceDirectory());
  if (target.kind !== "reach") return Promise.resolve(false);
  return new Promise((resolveWake) => {
    const socket = connect(target.path);
    socket.once("connect", () => socket.end(Buffer.of(1), () => resolveWake(true)));
    socket.once("error", () => resolveWake(false));
  });
}

/** An exit wait that could not connect for a reason that proves nothing retries after this. */
const EXIT_WAIT_RETRY_MILLISECONDS = 1_000;
const EXIT_WAIT_RETRY_CEILING_MILLISECONDS = 5 * 60_000;

/**
 * Calls `onExit` once the process holding `token` exits or releases its presence, through a held
 * connection the kernel closes then: no timer, on every platform. Only a closed connection, a
 * missing socket, or a refusal from a process that is gone counts as the exit; a connection that
 * fails for another reason (EMFILE, EAGAIN) retries with backoff and is reported through
 * `onIssue`. A token this host cannot judge never calls it; `onIssue` says so. Returns a cancel.
 */
export function waitForProcessExit(
  token: string,
  onExit: () => void,
  options: { directory?: string; onIssue?: (issue: string | null) => void } = {},
): () => void {
  const target = reach(token, options.directory ?? processPresenceDirectory());
  let done = false;
  const exit = () => {
    if (done) return;
    done = true;
    onExit();
  };
  if (target.kind === "gone") {
    queueMicrotask(exit);
    return () => {
      done = true;
    };
  }
  if (target.kind === "unknown") {
    options.onIssue?.(`${token} cannot be judged from this host or namespace.`);
    return () => {
      done = true;
    };
  }
  const { parsed, path } = target;
  let socket: Socket | null = null;
  let retry: NodeJS.Timeout | null = null;
  let failures = 0;
  const open = () => {
    if (done) return;
    const current = connect(path);
    socket = current;
    current.unref();
    current.on("data", () => undefined);
    current.once("connect", () => {
      if (failures > 0) options.onIssue?.(null);
      failures = 0;
    });
    current.once("error", (error) => {
      const verdict = failedConnection(error, parsed);
      if (verdict === "gone") {
        sweep(path);
        return exit();
      }
      if (done) return;
      failures = Math.min(failures + 1, 32);
      // A refusal from a live process is a full backlog, at first: look again. One that lasts is a
      // stuck holder or a stale socket whose pid was reused, and is reported.
      if (verdict !== "alive")
        options.onIssue?.(`${token} could not be reached: ${String(error)}.`);
      else if (failures >= EXIT_WAIT_REFUSALS_REPORTED)
        options.onIssue?.(
          `${token} keeps refusing connections while pid ${parsed.pid} lives: the process is stuck, or its socket is stale and the pid was reused.`,
        );
      retry = setTimeout(
        open,
        Math.min(
          EXIT_WAIT_RETRY_CEILING_MILLISECONDS,
          EXIT_WAIT_RETRY_MILLISECONDS * 2 ** (failures - 1),
        ),
      );
      retry.unref();
    });
    // A connection that was open and closed is the holder's exit or release.
    current.once("close", (hadError) => {
      if (!hadError) exit();
    });
    current.once("end", exit);
  };
  open();
  return () => {
    done = true;
    if (retry !== null) clearTimeout(retry);
    socket?.destroy();
  };
}
