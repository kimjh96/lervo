import { resolve } from "node:path";
import { readableEventSchemaVersions } from "@lervo/event-contract";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { openPooledProjectStorage } from "./bootstrap.js";
import { createStorageBindingBatch } from "./storage-binding-batch.js";
import { assertMinimumWriterVersion, observeStorageBinding } from "./storage-pool-binding.js";
import { ProjectStorageError, type ProjectStorage } from "./types.js";

interface Lease {
  storage: ProjectStorage;
  binding?: Promise<string>;
  bindingConfirmed: boolean;
  openedAt: number;
  uses: number;
  active: number;
  invalid: boolean;
  drained?: () => void;
}
interface Entry {
  opening?: Promise<{ reportWriting: boolean }>;
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
    minimumEventSchemaVersion?: NonNullable<ProjectStorage["writableEventSchemaVersion"]>;
  } = {},
) {
  const minimumEventSchemaVersion = options.minimumEventSchemaVersion;
  if (
    minimumEventSchemaVersion !== undefined &&
    !(readableEventSchemaVersions as readonly number[]).includes(minimumEventSchemaVersion)
  )
    throw new TypeError("The minimum event writer version is unsupported.");
  const entries = new Map<string, Entry>();
  const observeTogether = createStorageBindingBatch((storage, required) =>
    observeStorageBinding(storage, required),
  );
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
          if (minimumEventSchemaVersion !== undefined) {
            const writer = await inspectEventWriterCoordinate(root);
            assertMinimumWriterVersion(
              writer.coordinate.selectedEventSchemaVersion,
              minimumEventSchemaVersion,
            );
          }
          const storage = await open(root);
          entry.lease = {
            storage,
            bindingConfirmed: false,
            openedAt: performance.now(),
            uses: 0,
            active: 0,
            invalid: false,
          };
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
  const pool = {
    startOpening(root: string): Promise<{ reportWriting: boolean }> {
      root = resolve(root);
      const entry = entries.get(root);
      if (!closed && entry?.opening) return entry.opening;
      // A capability hint chooses scheduling only; every effect still needs a fresh borrow.
      if (!closed && entry?.lease && !entry.closing && !entry.failure)
        return Promise.resolve({
          reportWriting: entry.lease.storage.events.reportWriter !== undefined,
        });
      const opening = pool.run(root, async (storage) => ({
        reportWriting: storage.events.reportWriter !== undefined,
      }));
      const held = entries.get(root);
      if (held) {
        held.opening = opening;
        void opening
          .finally(() => {
            if (held.opening === opening) delete held.opening;
          })
          .catch(() => undefined);
      }
      return opening;
    },
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
          const observe = held.pending > 1 ? observeTogether : observeStorageBinding;
          const initial = !borrowed.bindingConfirmed;
          const observation = observe(borrowed.storage, initial ? undefined : required);
          // A later observation cannot establish the baseline while the first one is in flight.
          borrowed.binding ??= observation;
          const [binding, baseline] = await Promise.all([observation, borrowed.binding]);
          if (borrowed.invalid || binding !== baseline)
            throw new ProjectStorageError(
              "storage_binding_changed",
              "The retained storage binding changed.",
            );
          // A new handle must match the live writer before its activation requirement is checked.
          if (initial)
            assertMinimumWriterVersion(borrowed.storage.writableEventSchemaVersion, required);
          borrowed.bindingConfirmed = true;
        };
        await checkCurrent(minimumEventSchemaVersion);
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
  return pool;
}
