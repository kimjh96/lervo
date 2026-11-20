import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";
import { residentWakeKey } from "@lervo/repository-knowledge-runtime";

import { watchRepositoryChanges } from "./repository-change-watch.js";

const REPOSITORY_WATCH_RETRY_MILLISECONDS = 60_000;

/**
 * Canonical event appends and repository edits both wake the resident knowledge owner (ADR-0461);
 * its adaptive reconciliation timer remains the backstop while a failed watcher is retried.
 */
export function subscribeKnowledgeWakeups(
  storage: Pick<ProjectStorage, "paths" | "events">,
  notify: () => void,
  watchRepository: typeof watchRepositoryChanges = watchRepositoryChanges,
  /** ADR-0601: whether the resident's last verdict is owner; a non-owner ignores the outbox. */
  owner: () => boolean = () => true,
): () => void {
  const stopEvents = watchProjectEventChanges(
    {
      path: storage.paths.eventDatabase,
      latest: () => storage.events.latest(),
      // ADR-0598: the resident's own outcome records never wake it, as on the CLI host.
      latestHash: () => residentWakeKey(storage.events, owner()),
    },
    // ADR-0602: the same channel-driven wait as the CLI host resident, with no poll.
    notify,
  );
  let stopped = false;
  let stopRepository: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const restart = () => {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      start();
    }, REPOSITORY_WATCH_RETRY_MILLISECONDS);
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
        else stopRepository = stop;
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
