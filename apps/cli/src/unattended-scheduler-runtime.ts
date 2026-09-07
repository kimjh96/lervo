import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";

import { resolveInsideRepository } from "@lervo/context";

const maximumLockBytes = 4 * 1024;

export interface UnattendedSchedulerRuntime {
  schedulerSessionId: string;
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
  killSwitchEngaged(): Promise<boolean>;
  release(): Promise<void>;
}

interface SchedulerLock {
  schemaVersion: 1;
  schedulerSessionId: string;
  pid: number;
  hostname: string;
  startedAt: string;
}

async function readLock(path: string): Promise<{ content: string; lock: SchedulerLock }> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumLockBytes) {
    throw new Error("The unattended scheduler lock is unsafe.");
  }
  const content = await readFile(path, "utf8");
  const lock = JSON.parse(content) as SchedulerLock;
  if (
    lock.schemaVersion !== 1 ||
    !/^ses_scheduler_[a-f0-9]{32}$/u.test(lock.schedulerSessionId) ||
    !Number.isSafeInteger(lock.pid) ||
    lock.pid < 1 ||
    typeof lock.hostname !== "string" ||
    lock.hostname.length === 0 ||
    !Number.isFinite(Date.parse(lock.startedAt))
  ) {
    throw new Error("The unattended scheduler lock is invalid.");
  }
  return { content, lock };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function createLock(path: string, lock: SchedulerLock): Promise<string> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  const content = `${JSON.stringify(lock)}\n`;
  let closed = false;
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close();
    closed = true;
    await rm(path, { force: true });
    throw error;
  } finally {
    if (!closed) await handle.close();
  }
  return content;
}

async function releaseOwnedLock(path: string, ownedContent: string): Promise<void> {
  try {
    const current = await readLock(path);
    if (current.content !== ownedContent) {
      throw new Error("The unattended scheduler lock ownership changed before release.");
    }
    await rm(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function acquireLock(path: string, lock: SchedulerLock): Promise<string> {
  try {
    return await createLock(path, lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const existing = await readLock(path);
  if (existing.lock.hostname !== hostname() || processAlive(existing.lock.pid)) {
    throw new Error("Another unattended scheduler owns this repository.");
  }
  const recoveryPath = `${path}.recovery`;
  let recoveryContent: string;
  try {
    recoveryContent = await createLock(recoveryPath, lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Another unattended scheduler is recovering this repository.", {
        cause: error,
      });
    }
    throw error;
  }
  try {
    const current = await readLock(path);
    if (
      current.content !== existing.content ||
      current.lock.hostname !== hostname() ||
      processAlive(current.lock.pid)
    ) {
      throw new Error("Another unattended scheduler owns this repository.");
    }
    await rm(path);
    try {
      return await createLock(path, lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Another unattended scheduler owns this repository.", { cause: error });
      }
      throw error;
    }
  } finally {
    await releaseOwnedLock(recoveryPath, recoveryContent);
  }
}

export async function openUnattendedSchedulerRuntime(input: {
  repositoryRoot: string;
  killSwitchPath: string;
  now?: () => Date;
}): Promise<UnattendedSchedulerRuntime> {
  const stateRoot = resolve(input.repositoryRoot, ".lervo/state");
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const lockPath = resolve(stateRoot, "unattended-scheduler.lock");
  const killSwitchPath = resolveInsideRepository(input.repositoryRoot, input.killSwitchPath);
  const now = input.now ?? (() => new Date());
  const schedulerSessionId = `ses_scheduler_${randomUUID().replaceAll("-", "")}`;
  const lock: SchedulerLock = {
    schemaVersion: 1,
    schedulerSessionId,
    pid: process.pid,
    hostname: hostname(),
    startedAt: now().toISOString(),
  };
  const ownedContent = await acquireLock(lockPath, lock);
  return {
    schedulerSessionId,
    now,
    sleep: (milliseconds) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    killSwitchEngaged: async () => {
      try {
        await lstat(killSwitchPath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    release: () => releaseOwnedLock(lockPath, ownedContent),
  };
}
