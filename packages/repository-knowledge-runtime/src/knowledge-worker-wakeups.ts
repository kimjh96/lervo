import type { ProjectStorage } from "@lervo/project-storage";

import { watchRepositoryChanges } from "./repository-change-watch.js";
import { watchResidentEventChanges } from "./resident-event-wakeup.js";

/** A failed repository watch restarts after this, doubling per failure up to the ceiling. */
export const REPOSITORY_WATCH_RETRY_MILLISECONDS = 60_000;
export const REPOSITORY_WATCH_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

export function repositoryWatchRetryDelay(failures: number): number {
  return Math.min(
    REPOSITORY_WATCH_RETRY_CEILING_MILLISECONDS,
    REPOSITORY_WATCH_RETRY_MILLISECONDS * 2 ** Math.min(Math.max(0, failures - 1), 30),
  );
}

/**
 * Canonical event appends and repository edits both wake the resident (ADR-0461). ADR-0602: this
 * is every host's default wake path, so a CLI host resident sees an edit as soon as a Node one.
 * A failed repository watch is visible (`repository_watch_unavailable`) until it is armed again,
 * and restarts with exponential backoff from a minute to fifteen; the restart timer is armed
 * only after a failure, and only a watch that stayed armed as long as its delay resets it.
 */
export function subscribeKnowledgeWakeups(
  storage: Pick<ProjectStorage, "paths" | "events">,
  notify: () => void,
  watchRepository: typeof watchRepositoryChanges = watchRepositoryChanges,
  /** ADR-0601: whether the resident's last verdict is owner; a non-owner ignores the outbox. */
  owner: () => boolean = () => true,
): () => void {
  // ADR-0598: the resident's own outcome records never wake it.
  const stopEvents = watchResidentEventChanges(storage, notify, owner);
  let stopped = false;
  let stopRepository: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let armedAt: number | null = null;
  const restart = () => {
    if (stopped || retry !== undefined) return;
    // A watch that stayed armed at least as long as its last delay was stable; one that keeps
    // failing right after it armed (a flapping watch) keeps backing off.
    if (armedAt !== null && Date.now() - armedAt >= repositoryWatchRetryDelay(failures))
      failures = 0;
    armedAt = null;
    failures = Math.min(failures + 1, 64);
    retry = setTimeout(() => {
      retry = undefined;
      start();
    }, repositoryWatchRetryDelay(failures));
    retry.unref();
  };
  const start = () => {
    if (stopped) return;
    watchRepository(storage.paths.repositoryRoot, notify, () => {
      stopRepository = undefined;
      notify();
      restart();
    })
      .then((stop) => {
        if (stopped) stop();
        else {
          stopRepository = stop;
          armedAt = Date.now();
        }
      })
      .catch(() => {
        notify();
        restart();
      });
  };
  start();
  return () => {
    stopped = true;
    if (retry !== undefined) clearTimeout(retry);
    stopRepository?.();
    stopEvents();
  };
}
