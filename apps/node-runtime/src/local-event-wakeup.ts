import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { SQLiteEventStore } from "@lervo/event-store-sqlite";

/** Directory notifications include WAL commits from other CLI processes. */
export function watchLocalEventChanges(
  store: Pick<SQLiteEventStore, "path" | "latest">,
  notify: () => void,
): () => void {
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let head = store.latest()?.eventHash ?? null;
  const filename = basename(store.path);
  try {
    watcher = watch(dirname(store.path), { persistent: false }, (_event, changed) => {
      if (
        changed !== null &&
        ![filename, `${filename}-wal`, `${filename}-shm`].includes(changed.toString())
      )
        return;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        try {
          const next = store.latest()?.eventHash ?? null;
          if (head !== next) {
            head = next;
            notify();
          }
        } catch {
          notify();
        }
      }, 50);
    });
    watcher.on("error", () => {
      watcher?.close();
      notify();
    });
  } catch {
    // Unsupported watchers retain the idle wait's bounded reconciliation fallback.
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    watcher?.close();
  };
}
