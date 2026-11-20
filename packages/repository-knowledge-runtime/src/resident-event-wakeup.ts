import {
  watchProjectEventChanges,
  type ProjectEventWatchOptions,
  type ProjectStorage,
} from "@lervo/project-storage";

import { residentWakeKey } from "./convergence-queue-observation.js";

/**
 * Wakes the resident when a canonical event or knowledge work it must react to appears, reading
 * only the head hash and outbox counts. ADR-0598: its own outcome records never wake it, so a
 * cycle cannot wake the next one.
 */
export function watchResidentEventChanges(
  storage: Pick<ProjectStorage, "paths" | "events">,
  notify: () => void,
  /** ADR-0601: whether this host's last verdict is owner; a non-owner ignores the outbox. */
  owner: () => boolean = () => true,
  options: ProjectEventWatchOptions = {},
): () => void {
  return watchProjectEventChanges(
    {
      path: storage.paths.eventDatabase,
      latest: () => storage.events.latest(),
      latestHash: () => residentWakeKey(storage.events, owner()),
      latestSeq: () => storage.events.latestSeq?.() ?? storage.events.latest()?.seq ?? null,
    },
    // ADR-0602: woken by the writer channel; there is no poll.
    notify,
    options,
  );
}
