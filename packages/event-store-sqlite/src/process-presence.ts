import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseSubscriberId, WINDOWS } from "./change-channel-layout.js";
import {
  kernelRelation,
  localBootKey,
  localHostKey,
  userStateDirectory,
} from "./process-identity.js";

/**
 * ADR-0602 step 3: a process proves it lives by listening, never by rewriting a heartbeat. Its
 * presence is a local socket (a Unix domain socket, a named pipe on Windows) that only a live
 * listener accepts on. A probe connects and hangs up. A waiter keeps a connection open, and the
 * kernel closes it the moment the holder exits or releases, so it waits for that with no timer.
 * A byte sent over a connection wakes the holder. A holder whose event loop is stuck still
 * accepts in the kernel's backlog, so a probe proves the process, not its progress; stalled work
 * is the event channel's stall finding.
 */
export interface HeldProcessPresence {
  /** `<host>-<boot>-<pid>-<nonce>`, recorded where readers look for this process. */
  readonly token: string;
  /** Settles once the presence is listening, or could not be. */
  readonly ready: Promise<void>;
  /** Why it could not be held; null while held or not yet settled. */
  issue(): string | null;
  release(): void;
}

export type ProcessPresenceProbe = "alive" | "gone" | "unknown";

/** Unix socket paths are limited to about a hundred bytes, so names stay short. */
const MAXIMUM_SOCKET_PATH_BYTES = 100;
const LINUX = process.platform === "linux";

/**
 * Where presence sockets live for this user: Linux uses the abstract namespace (no file at all),
 * Windows named pipes, and other systems the private user state directory, which no temporary
 * file cleaner touches. A socket path is limited to about a hundred bytes, so a state directory
 * too deep for it is replaced by a short owner-only directory under the home directory, named by
 * its hash. The directory is created again whenever a presence is held, and refused unless it is
 * this user's and no one else can enter it.
 */
export function processPresenceDirectory(): string {
  const state = userStateDirectory();
  const preferred = join(state, "run", "presence");
  if (
    WINDOWS ||
    Buffer.byteLength(join(preferred, `${"0".repeat(16)}.s`)) <= MAXIMUM_SOCKET_PATH_BYTES
  )
    return preferred;
  return join(
    homedir(),
    ".lervo-presence",
    createHash("sha256").update(state).digest("hex").slice(0, 12),
  );
}

function nonceOf(token: string): string | null {
  const parsed = parseSubscriberId(token);
  return parsed === null || !/^[0-9a-f]{16}$/u.test(parsed.nonce) ? null : parsed.nonce;
}

/** Where a presence lives: Linux's abstract namespace unless a test names a directory. */
interface PresencePlace {
  directory: string;
  abstract: boolean;
}

function place(directory: string | undefined): PresencePlace {
  return directory === undefined
    ? { directory: processPresenceDirectory(), abstract: LINUX }
    : { directory, abstract: false };
}

function socketPath({ directory, abstract }: PresencePlace, nonce: string): string {
  if (WINDOWS) return `\\\\.\\pipe\\lervo-presence-${nonce}`;
  return abstract ? `\0lervo-presence-${nonce}` : join(directory, `${nonce}.s`);
}

/** A directory of this user that no one else can enter, created if missing; null otherwise. */
function ownedDirectory(directory: string): string | null {
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
 * A presence that cannot be held is reported through `issue`, and readers then see it gone.
 */
export function holdProcessPresence(
  options: { onWake?: () => void; directory?: string } = {},
): HeldProcessPresence {
  const nonce = randomBytes(8).toString("hex");
  const token = `${localHostKey()}-${localBootKey()}-${process.pid}-${nonce}`;
  const where = place(options.directory);
  const path = socketPath(where, nonce);
  let problem: string | null = null;
  let released = false;
  const connections = new Set<Socket>();
  let server: Server | null = null;
  const ready = new Promise<void>((resolveReady) => {
    if (!WINDOWS && !where.abstract) {
      if (Buffer.byteLength(path) > MAXIMUM_SOCKET_PATH_BYTES) {
        problem = `${path} is longer than a local socket path may be.`;
        return resolveReady();
      }
      problem = ownedDirectory(where.directory);
      if (problem !== null) return resolveReady();
    }
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
    listening.once("error", (error) => {
      problem = `${path} cannot be listened on: ${String(error)}`;
      resolveReady();
    });
    listening.listen(path, () => {
      server = listening;
      resolveReady();
    });
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
        server?.close();
        for (const socket of connections) socket.destroy();
      });
    },
  };
}

/** Whether this kernel can judge the token's process; another host's never can. */
function relation(token: string): "same" | "other_boot" | "unknown" {
  const parsed = parseSubscriberId(token);
  if (parsed === null) return "unknown";
  const kernel = kernelRelation(parsed.host, parsed.boot);
  return kernel === "same_kernel" ? "same" : kernel === "other_boot" ? "other_boot" : "unknown";
}

/** Connects to the token's presence; null when the token cannot be judged on this host. */
function reach(token: string, where: PresencePlace): Socket | "gone" | null {
  const nonce = nonceOf(token);
  if (nonce === null) return null;
  const kernel = relation(token);
  if (kernel === "other_boot") return "gone";
  if (kernel !== "same") return null;
  return connect(socketPath(where, nonce));
}

function gone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
}

/** Removes a socket file no listener holds, so presence files never accumulate. */
function sweep(token: string, where: PresencePlace): void {
  const nonce = nonceOf(token);
  if (nonce !== null && !WINDOWS && !where.abstract)
    rmSync(socketPath(where, nonce), { force: true });
}

/**
 * Whether the process holding `token` lives. `gone` is proven by this kernel: nothing listens on
 * its socket, or it belongs to a previous boot. `unknown` means this host cannot judge it.
 */
export function probeProcessPresence(
  token: string,
  options: { directory?: string } = {},
): Promise<ProcessPresenceProbe> {
  const where = place(options.directory);
  const socket = reach(token, where);
  if (socket === null) return Promise.resolve("unknown");
  if (socket === "gone") return Promise.resolve("gone");
  return new Promise((resolveProbe) => {
    socket.once("connect", () => {
      socket.destroy();
      resolveProbe("alive");
    });
    socket.once("error", (error) => {
      if (gone(error)) {
        if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") sweep(token, where);
        resolveProbe("gone");
      } else resolveProbe("unknown");
    });
  });
}

/** Wakes the process holding `token`; resolves whether it was reached. Never waits on it. */
export function wakeProcessPresence(
  token: string,
  options: { directory?: string } = {},
): Promise<boolean> {
  const socket = reach(token, place(options.directory));
  if (socket === null || socket === "gone") return Promise.resolve(false);
  return new Promise((resolveWake) => {
    socket.once("connect", () => socket.end(Buffer.of(1), () => resolveWake(true)));
    socket.once("error", () => resolveWake(false));
  });
}

/**
 * Calls `onExit` once the process holding `token` exits or releases its presence, through a held
 * connection the kernel closes then: no timer, on every platform. A token this host cannot judge
 * never calls it. Returns a cancel.
 */
export function waitForProcessExit(
  token: string,
  onExit: () => void,
  options: { directory?: string } = {},
): () => void {
  const where = place(options.directory);
  let done = false;
  const exit = () => {
    if (done) return;
    done = true;
    onExit();
  };
  const socket = reach(token, where);
  if (socket === null) return () => undefined;
  if (socket === "gone") {
    queueMicrotask(exit);
    return () => {
      done = true;
    };
  }
  socket.unref();
  socket.on("data", () => undefined);
  socket.once("error", (error) => {
    if (gone(error)) sweep(token, where);
    exit();
  });
  socket.once("close", exit);
  return () => {
    done = true;
    socket.destroy();
  };
}
