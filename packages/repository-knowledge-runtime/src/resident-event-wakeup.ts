import { watchProjectEventChanges, type ProjectStorage } from "@lervo/project-storage";

import { residentWakeKey } from "./convergence-queue-observation.js";

/**
 * ADR-0597: how often a resident polls the event head behind a working directory watch. The
 * poll only backs up notifications a filesystem may omit; a failed watch polls every second.
 */
export const RESIDENT_EVENT_POLL_MILLISECONDS = 30_000;

/**
 * Wakes the resident when a canonical event or knowledge work it must react to appears, reading
 * only the head hash and outbox counts. ADR-0598: its own outcome records never wake it, so a
 * cycle cannot wake the next one.
 */
export function watchResidentEventChanges(
  storage: Pick<ProjectStorage, "paths" | "events">,
  notify: () => void,
): () => void {
  return watchProjectEventChanges(
    {
      path: storage.paths.eventDatabase,
      latest: () => storage.events.latest(),
      latestHash: () => residentWakeKey(storage.events),
    },
    notify,
    { watchedPollMilliseconds: RESIDENT_EVENT_POLL_MILLISECONDS },
  );
}
