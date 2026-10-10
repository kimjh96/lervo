import { resolve } from "node:path";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { openPooledProjectStorage } from "./bootstrap.js";
import { assertRequiredWriterVersion, observeStorageBinding } from "./storage-pool-binding.js";
import { ProjectStorageError, type ProjectStorage } from "./types.js";

interface Lease {
  storage: ProjectStorage;
  binding: string;
  openedAt: number;
  uses: number;
  active: number;
  invalid: boolean;
  drained?: () => void;
}
interface Entry {
  pending: number;
  lease?: Lease;
  transition?: Promise<void>;
  settled?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
  failure?: unknown;
}
const maximumRoots = 8,
  maximumPending = 16,
  maximumUses = 64;
const maximumLifetimeMs = 1000,
  idleMs = 50;

/** Bounds borrowed storage handles while allowing independent CAS preparation to overlap. */
export function createProjectStoragePool(
  open: (root: string) => Promise<ProjectStorage> = openPooledProjectStorage,
  options: {
    requiredEventSchemaVersion?: NonNullable<ProjectStorage["writableEventSchemaVersion"]>;
  } = {},
) {
  const requiredEventSchemaVersion = options.requiredEventSchemaVersion;
  if (
    requiredEventSchemaVersion !== undefined &&
    ![1, 2, 3, 4, 5, 6].includes(requiredEventSchemaVersion)
  )
    throw new TypeError("The required event writer version is unsupported.");
  const entries = new Map<string, Entry>();
  let closed = false;
  async function discard(entry: Entry) {
    if (entry.transition) return entry.transition;
    const lease = entry.lease;
    if (!lease) return;
    entry.transition = (async () => {
      if (lease.active)
        await new Promise<void>((resolve) => {
          lease.drained = resolve;
        });
      try {
        await lease.storage.close();
        delete entry.lease;
      } catch (error) {
        entry.failure = new ProjectStorageError("cleanup_failed", "Storage cleanup failed.", {
          cause: error,
        });
        throw entry.failure;
      }
    })();
    try {
      await entry.transition;
    } finally {
      delete entry.transition;
    }
  }
  async function acquire(root: string, entry: Entry): Promise<Lease> {
    while (true) {
      if (entry.failure) throw entry.failure;
      if (entry.transition) {
        await entry.transition;
        continue;
      }
      if (!entry.lease) {
        entry.transition = (async () => {
          if (requiredEventSchemaVersion !== undefined) {
            const writer = await inspectEventWriterCoordinate(root);
            assertRequiredWriterVersion(
              writer.coordinate.selectedEventSchemaVersion,
              requiredEventSchemaVersion,
            );
          }
          const storage = await open(root);
          try {
            const binding = await observeStorageBinding(storage);
            entry.lease = {
              storage,
              binding,
              openedAt: performance.now(),
              uses: 0,
              active: 0,
              invalid: false,
            };
          } catch (error) {
            try {
              await storage.close();
            } catch (cleanupError) {
              entry.failure = new ProjectStorageError(
                "cleanup_failed",
                "Storage binding and cleanup failed.",
                { cause: new AggregateError([error, cleanupError]) },
              );
              throw entry.failure;
            }
            throw error;
          }
        })();
        try {
          await entry.transition;
        } finally {
          delete entry.transition;
        }
        continue;
      }
      const lease = entry.lease;
      if (
        lease.invalid ||
        lease.uses >= maximumUses ||
        performance.now() - lease.openedAt >= maximumLifetimeMs
      ) {
        await discard(entry);
        continue;
      }
      lease.uses++;
      lease.active++;
      return lease;
    }
  }
  function retire(root: string, entry: Entry): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer);
    entry.closing ??= (async () => {
      if (entry.pending)
        await new Promise<void>((resolve) => {
          entry.settled = resolve;
        });
      await discard(entry);
      if (entry.failure) throw entry.failure;
      if (entries.get(root) === entry) entries.delete(root);
    })();
    return entry.closing;
  }
  return {
    async run<T>(
      root: string,
      work: (storage: ProjectStorage, assertCurrent: () => Promise<void>) => Promise<T>,
    ): Promise<T> {
      root = resolve(root);
      let entry = entries.get(root);
      if (
        closed ||
        entry?.closing ||
        (entry && entry.pending >= maximumPending) ||
        (!entry && entries.size >= maximumRoots)
      )
        throw new ProjectStorageError("storage_busy", "The bounded storage pool is unavailable.");
      if (!entry) {
        entry = { pending: 0 };
        entries.set(root, entry);
      }
      const held = entry;
      if (held.timer) clearTimeout(held.timer);
      held.pending++;
      let lease: Lease | undefined;
      try {
        lease = await acquire(root, held);
        const borrowed = lease;
        const checkCurrent = async (required?: ProjectStorage["writableEventSchemaVersion"]) => {
          const binding = await observeStorageBinding(borrowed.storage, required);
          if (borrowed.invalid || binding !== borrowed.binding)
            throw new ProjectStorageError(
              "storage_binding_changed",
              "The retained storage binding changed.",
            );
        };
        await checkCurrent(requiredEventSchemaVersion);
        return await work(borrowed.storage, () => checkCurrent());
      } catch (error) {
        if (lease) {
          lease.invalid = true;
          lease.active--;
          if (!lease.active) lease.drained?.();
          lease = undefined;
          try {
            await discard(held);
          } catch (cleanupError) {
            throw new ProjectStorageError(
              "cleanup_failed",
              "Storage operation and cleanup failed.",
              { cause: new AggregateError([error, cleanupError]) },
            );
          }
        }
        throw error;
      } finally {
        if (lease) {
          lease.active--;
          if (!lease.active) lease.drained?.();
        }
        held.pending--;
        if (!held.pending) {
          held.settled?.();
          if (!held.closing) {
            held.timer = setTimeout(() => {
              // Failed cleanup leaves the occupied entry poisoned instead of admitting another handle.
              void retire(root, held).catch((error: unknown) => {
                held.failure = error;
              });
            }, idleMs);
            held.timer.unref();
          }
        }
      }
    },
    async close(): Promise<void> {
      closed = true;
      const results = await Promise.allSettled(
        [...entries].map(([root, entry]) => retire(root, entry)),
      );
      const failures = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
      if (failures.length)
        throw new ProjectStorageError("cleanup_failed", "Storage pool cleanup failed.", {
          cause: new AggregateError(failures),
        });
    },
  };
}
