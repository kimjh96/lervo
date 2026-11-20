import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";
import { latestEventHash } from "@lervo/storage-contract";

/**
 * ADR-0597: how often a resident polls the event head behind a working directory watch. The
 * poll only backs up notifications a filesystem may omit; a failed watch polls every second.
 */
export const RESIDENT_EVENT_POLL_MILLISECONDS = 30_000;

/** Wakes the resident when another process appends a canonical event, reading only the head hash. */
export function watchResidentEventChanges(
  storage: Pick<ProjectStorage, "paths" | "events">,
  notify: () => void,
): () => void {
  return watchProjectEventChanges(
    {
      path: storage.paths.eventDatabase,
      latest: () => storage.events.latest(),
      latestHash: () => latestEventHash(storage.events),
    },
    notify,
    { watchedPollMilliseconds: RESIDENT_EVENT_POLL_MILLISECONDS },
  );
}
