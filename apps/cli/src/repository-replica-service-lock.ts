import type { ProcessObservation } from "@lervo/node-work-admission";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { isRuntimeLockBusy, withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";

/** The host lock file beside the coordinator configuration in the user state directory. */
export const REPOSITORY_REPLICA_SERVICE_LOCK_FILE = "repository-replica-service.lock";

// One restart may wait out the 120-second graceful stop bound and a 20-second start.
const DEFAULT_WAIT_MS = 180_000;
const POLL_INTERVAL_MS = 250;

/**
 * ADR-0573: runs one replica service apply at a time per host. A second `lervo upgrade` waits
 * for the first, then re-plans inside the lock, so it sees the restarted coordinator as current.
 * Waiting longer than one bounded restart fails with `replica_service_busy` and changes nothing.
 *
 * The state directory may be reached through a symbolic link, for example a relocated
 * `~/.local/state` or `LERVO_USER_STATE_DIRECTORY`. The lock lives in its physical directory:
 * the directory only holds the lock and its guard, nothing is deleted inside it, and every run
 * resolves the same link to the same lock. The shared lock's real-directory rule protects
 * runtime retention, which deletes inside its root, and stays unchanged there.
 */
export async function withRepositoryReplicaServiceLock<T>(
  path: string,
  work: () => Promise<T>,
  options: {
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    observeProcess?: (pid: number) => ProcessObservation;
  } = {},
): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const physical = resolve(await realpath(dirname(path)), basename(path));
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (;;) {
    let started = false;
    try {
      return await withNodeRuntimeRetentionLock(
        physical,
        () => {
          started = true;
          return work();
        },
        options.observeProcess === undefined ? {} : { observeProcess: options.observeProcess },
      );
    } catch (error) {
      // A busy runtime lock inside the work is that work's own failure, never a reason to retry.
      if (started || !isRuntimeLockBusy(error)) throw error;
      if (Date.now() >= deadline)
        throw Object.assign(
          new Error("Another repository replica service change is running on this host."),
          { code: "replica_service_busy" },
        );
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
