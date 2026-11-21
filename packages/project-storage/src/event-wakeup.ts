import { basename, dirname } from "node:path";
import {
  listenEventStoreChanges,
  type EventStoreChannelIssue,
  type EventStoreChannelListener,
} from "@lervo/event-store-sqlite";
import type { EventEnvelope } from "@lervo/schemas";
import { latestEventHash } from "@lervo/storage-contract";

import {
  watchChangeToken,
  type ChangeTokenChannel,
  type ChangeTokenWatchHealth,
} from "./change-token-watch.js";

/** Test seam: the channel a watch listens on, defaulting to the event store's FIFO channel. */
export interface ProjectEventWatchOptions {
  channel?: (
    path: string,
    ping: () => void,
    unavailable: () => void,
  ) => (ChangeTokenChannel & Partial<Pick<EventStoreChannelListener, "report" | "observe">>) | null;
  /** Test seam: false leaves out the directory watch that detects writers without a ping. */
  directoryWatch?: boolean;
}

function issues(health: ChangeTokenWatchHealth, path: string): EventStoreChannelIssue[] {
  const found: EventStoreChannelIssue[] = [];
  if (health.writerWithoutPing)
    found.push({
      code: "event_channel_writer_without_ping",
      detail: `A process committed to ${path} without pinging this subscriber: an older Lervo binary, or a process of another user that cannot open its FIFO. Run lervo upgrade, stop older Lervo processes, and run Lervo as the database owner.`,
    });
  if (health.channelUnavailable)
    found.push({
      code: "event_channel_unavailable",
      detail: `This subscriber has no working FIFO for ${path}; it is woken only by the directory watch until the channel is rebuilt.`,
    });
  if (health.detectorUnavailable)
    found.push({
      code: "event_channel_detector_unavailable",
      detail: `The directory watch on ${dirname(path)} could not be armed, so writers that do not ping go unnoticed; raise the file watch limit.`,
    });
  return found;
}

/**
 * ADR-0602: wakes on a change to the event head, never on a timer. Every event-store commit pings
 * the database's FIFO channel synchronously, so the channel wakes the watch for every Lervo writer.
 * The kernel directory watch only detects writers that do not ping (an older binary during an
 * upgrade): such a commit still wakes the watch and is reported as visible state.
 */
export function watchProjectEventChanges(
  store: {
    path: string;
    latest(): EventEnvelope | null;
    latestHash?(): string | null;
    latestSeq?(): number | null;
  },
  notify: () => void,
  options: ProjectEventWatchOptions = {},
): () => void {
  const filename = basename(store.path);
  let listener: ReturnType<NonNullable<ProjectEventWatchOptions["channel"]>> = null;
  return watchChangeToken(() => latestEventHash(store), notify, {
    channel: (ping, unavailable) => {
      listener = (options.channel ?? listenEventStoreChanges)(store.path, ping, unavailable);
      return listener;
    },
    ...(options.directoryWatch === false
      ? {}
      : {
          directory: dirname(store.path),
          // The shared-memory file changes on reads too, so only the database and its WAL count.
          entries: [filename, `${filename}-wal`],
        }),
    onHealth: (health) => listener?.report?.(issues(health, store.path)),
    // ADR-0602: the head this subscriber has seen, so inspection can tell it stopped waking.
    onChecked: () => {
      try {
        listener?.observe?.(store.latestSeq?.() ?? store.latest()?.seq ?? null);
      } catch {
        // An unreadable head leaves the last observation; the next wake records it.
      }
    },
  });
}
