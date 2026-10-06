import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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

async function holderPid(path: string): Promise<number | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
    return Number.isSafeInteger(value.pid) && (value.pid as number) > 0
      ? (value.pid as number)
      : null;
  } catch {
    return null;
  }
}

export type HostKnowledgeResidentLock =
  { acquired: true; release: () => Promise<void> } | { acquired: false; holderPid: number | null };

/**
 * ADR-0470: at most one host resident serves a host. The lock file names its holder's PID; a
 * holder whose process is gone is replaced. A second resident (a hand-written service beside the
 * managed one, or a manual run) stays on standby and serves nothing until the holder exits.
 */
export async function acquireHostKnowledgeResidentLock(
  path: string,
  pid: number = process.pid,
  alive: (pid: number) => boolean = processAlive,
): Promise<HostKnowledgeResidentLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, `${JSON.stringify({ schemaVersion: 1, pid })}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(path, 0o600);
      let released = false;
      return {
        acquired: true,
        release: async () => {
          if (released) return;
          released = true;
          if ((await holderPid(path)) === pid) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = await holderPid(path);
    if (holder === pid) return { acquired: false, holderPid: holder };
    if (holder !== null && alive(holder)) return { acquired: false, holderPid: holder };
    // The holder is gone or the file is unreadable: remove it and race once for the lock.
    await rm(path, { force: true });
  }
  return { acquired: false, holderPid: await holderPid(path) };
}
