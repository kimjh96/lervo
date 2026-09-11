import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage, resolveRepositoryCoordinationHome } from "@lervo/project-storage";

const STALE_LOCK_MILLISECONDS = 60_000;

async function staleLock(path: string): Promise<boolean> {
  const lock = JSON.parse(await readFile(path, "utf8")) as {
    pid?: unknown;
    hostname?: unknown;
    createdAt?: unknown;
  };
  const age = typeof lock.createdAt === "string" ? Date.now() - Date.parse(lock.createdAt) : 0;
  let alive = true;
  if (
    lock.hostname === hostname() &&
    typeof lock.pid === "number" &&
    Number.isSafeInteger(lock.pid)
  ) {
    try {
      process.kill(lock.pid, 0);
    } catch (error) {
      alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }
  return age > STALE_LOCK_MILLISECONDS && !alive;
}

async function acquireOrganizationMutation(root: string): Promise<() => Promise<void>> {
  const home = await resolveRepositoryCoordinationHome(root);
  await mkdir(home.locks, { recursive: true, mode: 0o700 });
  const path = resolve(home.locks, "agent-organization.lock");
  const create = async () => {
    const handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(
      `${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        hostname: hostname(),
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    await handle.sync();
    return handle;
  };
  let handle;
  try {
    handle = await create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let stale: boolean;
    try {
      stale = await staleLock(path);
    } catch (inspectionError) {
      throw new Error("The existing organization transition lock cannot be inspected safely.", {
        cause: inspectionError,
      });
    }
    if (!stale) {
      throw new Error("Another organization transition is in progress.", { cause: error });
    }
    await rm(path);
    handle = await create();
  }
  return async () => {
    await handle.close();
    await rm(path, { force: true });
  };
}

export async function mutateAgentOrganization<T>(
  root: string,
  operation: (storage: Awaited<ReturnType<typeof openProjectStorage>>) => Promise<T>,
): Promise<T> {
  const release = await acquireOrganizationMutation(root);
  let storage: Awaited<ReturnType<typeof openProjectStorage>> | undefined;
  try {
    storage = await openProjectStorage(root);
    return await operation(storage);
  } finally {
    await storage?.close();
    await release();
  }
}
