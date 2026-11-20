import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { probeProcessPresence } from "@lervo/project-storage";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

export const HOST_KNOWLEDGE_RESIDENT_LOCK_FILE = "knowledge-host-resident.lock";

export function hostKnowledgeResidentLockPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  try {
    return resolve(
      dirname(defaultRepositoryRegistryPath(environment)),
      HOST_KNOWLEDGE_RESIDENT_LOCK_FILE,
    );
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface LockHolder {
  pid: number;
  /** ADR-0602: the holder's process presence; absent from earlier releases. */
  presence: string | null;
}

async function holder(path: string): Promise<LockHolder | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; presence?: unknown };
    if (!Number.isSafeInteger(value.pid) || (value.pid as number) <= 0) return null;
    return {
      pid: value.pid as number,
      presence: typeof value.presence === "string" ? value.presence : null,
    };
  } catch {
    return null;
  }
}

/** A holder lives while its presence answers; without one, while its process does. */
async function holderAlive(entry: LockHolder, alive: (pid: number) => boolean): Promise<boolean> {
  if (entry.presence === null) return alive(entry.pid);
  const probe = await probeProcessPresence(entry.presence);
  return probe === "alive" || (probe === "unknown" && alive(entry.pid));
}

export type HostKnowledgeResidentLock =
  | { acquired: true; release: () => Promise<void> }
  | { acquired: false; holderPid: number | null; holderPresence: string | null };

/**
 * ADR-0470: at most one host resident serves a host. The lock file names its holder's PID and,
 * ADR-0602, its process presence; a holder that is gone is replaced. A second resident (a
 * hand-written service beside the managed one, or a manual run) stays on standby and serves
 * nothing until the holder exits, which it waits for on the holder's presence, with no timer.
 */
export async function acquireHostKnowledgeResidentLock(
  path: string,
  pid: number = process.pid,
  alive: (pid: number) => boolean = processAlive,
  presence: string | null = null,
): Promise<HostKnowledgeResidentLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(
        path,
        `${JSON.stringify({ schemaVersion: 1, pid, ...(presence === null ? {} : { presence }) })}\n`,
        {
          flag: "wx",
          mode: 0o600,
        },
      );
      await chmod(path, 0o600);
      let released = false;
      return {
        acquired: true,
        release: async () => {
          if (released) return;
          released = true;
          if ((await holder(path))?.pid === pid) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const current = await holder(path);
    const standby = (entry: LockHolder) =>
      ({ acquired: false, holderPid: entry.pid, holderPresence: entry.presence }) as const;
    if (current?.pid === pid) return standby(current);
    if (current !== null && (await holderAlive(current, alive))) return standby(current);
    // The holder is gone or the file is unreadable: remove it and race once for the lock.
    await rm(path, { force: true });
  }
  const last = await holder(path);
  return { acquired: false, holderPid: last?.pid ?? null, holderPresence: last?.presence ?? null };
}
