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
 */
export async function withRepositoryReplicaServiceLock<T>(
  path: string,
  work: () => Promise<T>,
  options: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS);
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (;;) {
    let started = false;
    try {
      return await withNodeRuntimeRetentionLock(path, () => {
        started = true;
        return work();
      });
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
