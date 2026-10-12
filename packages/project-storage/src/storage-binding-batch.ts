import type { observeStorageBinding } from "./storage-pool-binding.js";
import type { ProjectStorage } from "./types.js";

type Observe = typeof observeStorageBinding;
type RequiredVersion = Parameters<Observe>[1];
interface PendingObservation {
  resolve: (binding: string) => void;
  reject: (error: unknown) => void;
}
interface StoreObservations {
  pending: number;
  queues: Map<RequiredVersion, PendingObservation[]>;
}

/** Only callers admitted before an observation starts may share its fresh result. */
export function createStorageBindingBatch(observe: Observe): Observe {
  const stores = new WeakMap<ProjectStorage, StoreObservations>();
  return (storage, required) => {
    let state = stores.get(storage);
    if (!state) {
      state = { pending: 0, queues: new Map() };
      stores.set(storage, state);
    }
    if (state.pending >= 16) return observe(storage, required);
    const held = state;
    held.pending++;
    let group = held.queues.get(required);
    if (!group) {
      group = [];
      held.queues.set(required, group);
      const admitted = group;
      setImmediate(() => {
        held.queues.delete(required);
        void Promise.resolve()
          .then(() => observe(storage, required))
          .then(
            (binding) => {
              held.pending -= admitted.length;
              for (const pending of admitted) pending.resolve(binding);
            },
            (error: unknown) => {
              held.pending -= admitted.length;
              for (const pending of admitted) pending.reject(error);
            },
          );
      });
    }
    return new Promise<string>((resolve, reject) => group.push({ resolve, reject }));
  };
}
