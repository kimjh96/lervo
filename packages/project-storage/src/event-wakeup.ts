import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import type { EventEnvelope } from "@lervo/schemas";
import { latestEventHash } from "@lervo/storage-contract";

/**
 * Some local filesystems omit directory notifications for WAL commits, so the head is also
 * polled. ADR-0597: the poll reads only the head hash, and a caller that tolerates a slower
 * backup (the knowledge resident) may poll less often while the watch works; after a watch
 * failure the poll always returns to this interval.
 */
export const EVENT_WAKEUP_POLL_MILLISECONDS = 1_000;

/** Directory notifications include WAL commits from other CLI processes. */
export function watchProjectEventChanges(
  store: { path: string; latest(): EventEnvelope | null; latestHash?(): string | null },
  notify: () => void,
  options: { watchedPollMilliseconds?: number } = {},
): () => void {
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let head = latestEventHash(store);
  const check = () => {
    try {
      const next = latestEventHash(store);
      if (head !== next) {
        head = next;
        notify();
      }
    } catch {
      notify();
    }
  };
  const poll = (milliseconds: number) => {
    if (fallback !== undefined) clearInterval(fallback);
    fallback = setInterval(check, milliseconds);
    fallback.unref();
  };
  const unwatched = () => {
    watcher?.close();
    watcher = undefined;
    if (!closed) poll(EVENT_WAKEUP_POLL_MILLISECONDS);
  };
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
      unwatched();
      notify();
    });
    poll(options.watchedPollMilliseconds ?? EVENT_WAKEUP_POLL_MILLISECONDS);
  } catch {
    // Unsupported watchers keep the one-second head poll.
    unwatched();
  }
  return () => {
    closed = true;
    if (fallback !== undefined) clearInterval(fallback);
    if (timer !== undefined) clearTimeout(timer);
    watcher?.close();
  };
}
