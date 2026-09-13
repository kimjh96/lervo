import { loadProjectManifest } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { mkdir, lstat, readFile, open, rm, chmod, rename } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import {
  MAXIMUM_STATE_BYTES,
  fail,
  validTime,
  STALE_LOCK_MS,
} from "./workforce-state-validation.js";
import { AgentWorkforceError, type WorkforceEvent, type WorkforceEventRecorder } from "./types.js";
import { constants } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export async function state(root: string, options: { readOnly?: boolean } = {}) {
  const manifest = await loadProjectManifest(root);
  const base = (await resolveRepositoryCoordinationHome(root, options)).workforce;
  if (options.readOnly !== true)
    await mkdir(resolve(base, "assignments"), { recursive: true, mode: 0o700 });
  return { base, manifest };
}

export async function readBounded(path: string): Promise<string | null> {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAXIMUM_STATE_BYTES ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      fail("workforce_state_invalid", "A workforce state file is unsafe.");
    return readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof AgentWorkforceError) throw error;
    fail("workforce_state_invalid", "A workforce state file could not be read.", error);
  }
}

export async function acquireLock(path: string, now: Date): Promise<() => Promise<void>> {
  const create = async () => {
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, pid: process.pid, hostname: hostname(), createdAt: now.toISOString() })}\n`,
    );
    await handle.sync();
    return handle;
  };
  let handle;
  try {
    handle = await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      const lock = JSON.parse((await readBounded(path)) ?? "null") as {
        pid?: unknown;
        hostname?: unknown;
        createdAt?: unknown;
      } | null;
      const age =
        lock !== null && validTime(lock.createdAt) ? now.getTime() - Date.parse(lock.createdAt) : 0;
      let alive = true;
      if (
        lock?.hostname === hostname() &&
        typeof lock.pid === "number" &&
        Number.isSafeInteger(lock.pid)
      ) {
        try {
          process.kill(lock.pid, 0);
        } catch (processError) {
          alive = (processError as NodeJS.ErrnoException).code !== "ESRCH";
        }
      }
      if (age > STALE_LOCK_MS && !alive) {
        await rm(path);
        handle = await create();
      } else fail("workforce_busy", "Another workforce transition is in progress.");
    } catch (lockError) {
      if (lockError instanceof AgentWorkforceError) throw lockError;
      fail("workforce_busy", "The workforce lock cannot be recovered safely.", lockError);
    }
  }
  return async () => {
    await handle!.close();
    await rm(path, { force: true });
  };
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function transition<T>(input: {
  path: string;
  lockPath: string;
  now: Date;
  content: string;
  event?: WorkforceEvent;
  recordEvent?: WorkforceEventRecorder;
  result: T;
  expectedBefore?: string | null;
  beforeWrite?(): Promise<void>;
}): Promise<T> {
  const release = await acquireLock(input.lockPath, input.now);
  let before: string | null;
  try {
    before = await readBounded(input.path);
    if (Object.hasOwn(input, "expectedBefore") && before !== input.expectedBefore)
      fail("agent_state_conflict", "The workforce state changed before apply.");
    await input.beforeWrite?.();
    await atomicWrite(input.path, input.content);
    try {
      if (input.recordEvent !== undefined) {
        if (input.event === undefined)
          fail("workforce_write_failed", "The workforce transition event is missing.");
        await input.recordEvent(input.event);
      }
    } catch (error) {
      if (before === null) await rm(input.path, { force: true });
      else await atomicWrite(input.path, before);
      fail("workforce_write_failed", "The workforce event failed and state was restored.", error);
    }
    return input.result;
  } finally {
    await release();
  }
}

export async function retryConcurrent<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof AgentWorkforceError) ||
        !["workforce_busy", "agent_state_conflict"].includes(error.code) ||
        attempt === 7
      )
        throw error;
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5 * (attempt + 1)));
    }
  }
  throw new AgentWorkforceError(
    "workforce_busy",
    "The workforce transition could not acquire a stable snapshot.",
  );
}
