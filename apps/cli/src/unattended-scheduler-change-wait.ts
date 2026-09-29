import { watch, type FSWatcher } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { resolveProjectPaths } from "@lervo/project";

/** Advisory wakeup; the scheduler rechecks its lock, policy, leases, and kill switch. */
export function createSchedulerChangeWait(root: string, killSwitchPath: string) {
  const watchers: FSWatcher[] = [];
  let pending = false;
  let release: (() => void) | undefined;
  const notify = () => {
    pending = true;
    release?.();
  };
  const database = resolveProjectPaths(root).eventDatabase;
  for (const [path, names] of [
    [database, [basename(database), `${basename(database)}-wal`]],
    [killSwitchPath, [basename(killSwitchPath)]],
  ] as const) {
    try {
      const watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
        if (name === null || names.includes(name.toString())) notify();
      });
      watcher.on("error", () => {
        watcher.close();
        notify();
      });
      watchers.push(watcher);
    } catch {
      /* Missing directories or unavailable watchers retain the configured recovery timer. */
    }
  }
  return {
    wait: async (milliseconds: number): Promise<void> => {
      if (pending) {
        pending = false;
        return;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          clearInterval(killSwitchRecovery);
          release = undefined;
          pending = false;
          resolve();
        };
        const timer = setTimeout(finish, milliseconds);
        const killSwitchRecovery = setInterval(() => {
          void lstat(killSwitchPath)
            .then(finish)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") finish();
            });
        }, 1000);
        killSwitchRecovery.unref();
        release = finish;
      });
    },
    close: () => {
      for (const watcher of watchers) watcher.close();
      release?.();
    },
  };
}
