import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** ADR-0602: where the event-store wake channel of one database lives, and who may use it. */
export const FIFO_SUFFIX = ".fifo";
/** Windows: a subscriber's ping file, which writers append to, and its liveness lock. */
export const PING_SUFFIX = ".ping";
export const LOCK_SUFFIX = ".lock";
export const RECORD_SUFFIX = ".json";
export const WINDOWS = process.platform === "win32";

export interface EventStoreChannelLocation {
  /** Holds only the subscribers' FIFOs (or pipe markers); nothing else walks it. */
  run: string;
  /** Holds the channel's visible records, in derived state. */
  records: string;
  /** Whether the database sits in a repository's `.lervo/data`. */
  repositoryLayout: boolean;
}

/**
 * For `<repository>/.lervo/data/<name>` the FIFOs live in `<repository>/.lervo/run/<name>`, outside
 * derived state, so `lervo state` reset, prune and status never move or read them, and the records
 * in `.lervo/state/event-channel/<name>`. Any other database keeps both beside itself. Paths are
 * keyed by the real directory, so every process that can write the database finds the same ones.
 */
export function eventStoreChannelLocation(databasePath: string): EventStoreChannelLocation {
  let directory = resolve(dirname(databasePath));
  try {
    directory = realpathSync(directory);
  } catch {
    // A database directory that does not exist yet keeps its resolved path.
  }
  const name = basename(databasePath);
  if (basename(directory) === "data" && basename(dirname(directory)) === ".lervo") {
    const lervo = dirname(directory);
    return {
      run: join(lervo, "run", name),
      records: join(lervo, "state", "event-channel", name),
      repositoryLayout: true,
    };
  }
  return {
    run: join(directory, `${name}.run`),
    records: join(directory, `${name}.run-records`),
    repositoryLayout: false,
  };
}

/** The run directory of one event database. */
export function eventStoreChannelDirectory(databasePath: string): string {
  return eventStoreChannelLocation(databasePath).run;
}

export function owner(path: string): number | null {
  try {
    return lstatSync(path).uid;
  } catch {
    return null;
  }
}

export function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Why `stats` may not hold the channel, or null when it may: it must be a real directory owned by
 * the database owner and by this process's effective user, and writable by nobody else.
 */
function refusal(stats: Stats, expectedUid: number | null): string | null {
  if (stats.isSymbolicLink()) return "is a symbolic link";
  if (!stats.isDirectory()) return "is not a directory";
  if (WINDOWS) return null;
  if (expectedUid !== null && stats.uid !== expectedUid)
    return `is owned by uid ${stats.uid}, not the database owner ${expectedUid}`;
  const effective = process.geteuid?.();
  if (effective !== undefined && stats.uid !== effective)
    return `is owned by uid ${stats.uid}, not this process's user ${effective}`;
  if ((stats.mode & 0o022) !== 0) return "is writable by group or others";
  return null;
}

/** Checks a channel directory and its parent with lstat; returns the refusal reason or null. */
export function checkChannelDirectory(databasePath: string, directory: string): string | null {
  const expectedUid = owner(databasePath);
  for (const level of [dirname(directory), directory]) {
    const reason = refusal(lstatSync(level), expectedUid);
    if (reason !== null) return `${level} ${reason}`;
  }
  return null;
}

/**
 * Creates a channel directory (mode 700) and checks it. In a repository the `.lervo/run` root
 * also gets a `.gitignore` that ignores everything, so Git never sees the FIFOs.
 */
export function prepareChannelDirectory(databasePath: string, directory: string): string | null {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const location = eventStoreChannelLocation(databasePath);
    if (location.repositoryLayout && directory === location.run) {
      const ignore = join(dirname(directory), ".gitignore");
      if (lstatOrNull(ignore) === null) writeFileSync(ignore, "*\n", { mode: 0o600 });
    }
    return checkChannelDirectory(databasePath, directory);
  } catch (error) {
    return `${directory} cannot be prepared: ${String(error)}`;
  }
}

/** `<host>-<boot>-<pid>-<nonce>`: who a FIFO, ping file or record belongs to. */
export function parseSubscriberId(
  id: string,
): { host: string; boot: string; pid: number; nonce: string } | null {
  const match =
    /^([0-9a-f]{12}|unknown)-(b[0-9a-f]{12}|t[0-9]+|unknown)-([0-9]+)-([0-9a-f]+)$/u.exec(id);
  return match === null
    ? null
    : { host: match[1]!, boot: match[2]!, pid: Number(match[3]), nonce: match[4]! };
}

/**
 * Windows: whether a subscriber's lock is held. The subscriber holds it open with an exclusive
 * share mode for as long as it lives, so an exclusive open succeeds only once it has exited.
 */
/**
 * libuv's exclusive share mode for `open` on Windows (`UV_FS_O_EXLOCK`, 0x10000000 in uv/win.h).
 * Node passes open flags to libuv unchanged, so the value works even where Node does not export
 * the constant.
 */
export function exclusiveLockFlag(): number {
  return (
    (constants as Record<string, number | undefined>).UV_FS_O_EXLOCK ?? (WINDOWS ? 0x10000000 : 0)
  );
}

export function windowsLockState(path: string): "held" | "free" | "missing" {
  try {
    closeSync(openSync(path, constants.O_RDWR | exclusiveLockFlag()));
    return "free";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "held";
  }
}
