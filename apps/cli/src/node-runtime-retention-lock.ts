import {
  birthIdentityContradicts,
  PROCESS_BIRTH_IDENTITY,
} from "./node-runtime-process-binding.js";
import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createProcessObserver, type ProcessObservation } from "@lervo/node-work-admission";
import { openSqliteDatabase } from "@lervo/sqlite-connection";

const RUNTIME_LOCK_BUSY = "runtime_lock_busy";

function runtimeLockBusy(): Error {
  return Object.assign(new Error("Another runtime operation is active."), {
    code: RUNTIME_LOCK_BUSY,
  });
}

/** Whether acquiring the lock failed only because a live holder or a racing acquirer had it. */
export function isRuntimeLockBusy(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === RUNTIME_LOCK_BUSY;
}

const MAXIMUM_LOCK_BYTES = 256;

/**
 * The lock holds `<pid>` and, since ADR-0573, `\n<birth identity>`. A pid-only lock, written by
 * an older CLI or by a holder whose birth could not be observed, still reads as a pid.
 */
function parseLockOwner(text: string): { pid: number; identity: string | null } {
  const [pidText = "", identity = null, ...rest] = text.replace(/\n$/u, "").split("\n");
  const pid = Number(pidText);
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    rest.length > 0 ||
    (identity !== null && !PROCESS_BIRTH_IDENTITY.test(identity))
  )
    throw new Error("Invalid runtime lock owner.");
  return { pid, identity };
}

/**
 * Whether the recorded holder still runs. A dead pid frees the lock. So does a live pid whose
 * birth identity differs under the same identity scheme: the pid was reused after the holder
 * died, for example across a WSL restart. An unobservable birth or a pid-only lock is judged by
 * the pid alone, as before, so the lock fails closed.
 */
function lockHolderAlive(
  owner: { pid: number; identity: string | null },
  observeProcess: (pid: number) => ProcessObservation,
): boolean {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
  }
  if (owner.identity === null) return true;
  const observed = observeProcess(owner.pid);
  return observed.status !== "absent" && !birthIdentityContradicts(observed, owner.identity);
}

/** One host guard serializes lock recovery; the PID lock spans asynchronous runtime effects. */
export async function withNodeRuntimeRetentionLock<T>(
  path: string,
  work: () => Promise<T>,
  options: { observeProcess?: (pid: number) => ProcessObservation } = {},
): Promise<T> {
  const observeProcess = options.observeProcess ?? createProcessObserver();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertRealRuntimeRoot(dirname(path));
  const guardPath = `${path}.sqlite`;
  const guardInfo = await lstat(guardPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (guardInfo && (!guardInfo.isFile() || guardInfo.isSymbolicLink()))
    throw new Error("Unsafe runtime lock guard.");
  const guard = openSqliteDatabase(guardPath, { busyTimeoutMs: 0 });
  try {
    try {
      guard.exec("BEGIN IMMEDIATE");
    } catch (error) {
      // The guard is held only for the instant another process takes or recovers the lock.
      if (/busy|locked/iu.test((error as Error).message)) throw runtimeLockBusy();
      throw error;
    }
    try {
      const previous = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let text;
      try {
        const info = fstatSync(previous);
        if (!info.isFile() || info.size > MAXIMUM_LOCK_BYTES)
          throw new Error("Unsafe runtime lock.");
        text = readFileSync(previous, "utf8");
      } finally {
        closeSync(previous);
      }
      // An empty lock is one whose holder died between creating and writing it.
      if (text.length > 0 && lockHolderAlive(parseLockOwner(text), observeProcess))
        throw runtimeLockBusy();
      rmSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const self = observeProcess(process.pid);
      writeFileSync(
        fd,
        self.status === "present" && PROCESS_BIRTH_IDENTITY.test(self.identity)
          ? `${process.pid}\n${self.identity}\n`
          : String(process.pid),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    guard.exec("COMMIT");
  } finally {
    guard.close();
  }
  try {
    return await work();
  } finally {
    rmSync(path, { force: true });
  }
}
