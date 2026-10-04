import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { EventEnvelope } from "@lervo/schemas";

/** Directory notifications include WAL commits from other CLI processes. */
export function watchProjectEventChanges(
  store: { path: string; latest(): EventEnvelope | null },
  notify: () => void,
): () => void {
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let head = store.latest()?.eventHash ?? null;
  const check = () => {
    try {
      const next = store.latest()?.eventHash ?? null;
      if (head !== next) {
        head = next;
        notify();
      }
    } catch {
      notify();
    }
  };
  // Some local filesystems silently omit WAL notifications; head polling remains bounded and cheap.
  const fallback = setInterval(check, 1_000);
  fallback.unref();
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
        check();
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
    clearInterval(fallback);
    if (timer !== undefined) clearTimeout(timer);
    watcher?.close();
  };
}
