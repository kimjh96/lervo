import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  openSync,
  statSync,
  truncateSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join } from "node:path";

import {
  eventStoreChannelLocation,
  exclusiveLockFlag,
  LOCK_SUFFIX,
  lstatOrNull,
  PING_SUFFIX,
  prepareChannelDirectory,
} from "./change-channel-layout.js";
import { sweepDeadChannels } from "./change-channel-inspection.js";
import { observationWriter, type EventStoreChannelListener } from "./change-channel-listener.js";
import {
  removeRecord,
  stalledRecordPath,
  subscriberRecordPath,
  writeSubscriberRecord,
  type EventStoreChannelIssue,
} from "./change-channel-state.js";
import { localBootKey, localHostKey } from "./process-identity.js";

/**
 * ADR-0602: the Windows subscriber. It watches its own ping file in the user's private run
 * directory, which writers append to; a lock held with an exclusive share mode proves it lives.
 */
/** Windows: a ping file is truncated once it grows past this, so it stays bounded. */
const PING_FILE_BOUND_BYTES = 4_096;

export function listenWindows(
  databasePath: string,
  onPing: () => void,
  onUnavailable: () => void,
): EventStoreChannelListener {
  const location = eventStoreChannelLocation(databasePath);
  const id = `${localHostKey()}-${localBootKey()}-${process.pid}-${randomBytes(16).toString("hex")}`;
  const pingName = `${id}${PING_SUFFIX}`;
  const ping = join(location.run, pingName);
  const lock = join(location.run, `${id}${LOCK_SUFFIX}`);
  let closed = false;
  let failed = false;
  let watcher: FSWatcher | null = null;
  let lockDescriptor: number | null = null;
  let channelIssue: EventStoreChannelIssue | null = null;
  let watchIssues: readonly EventStoreChannelIssue[] = [];
  let observed: { seq: number; at: number } | undefined;
  const record = () =>
    writeSubscriberRecord(
      location.records,
      id,
      [...(channelIssue === null ? [] : [channelIssue]), ...watchIssues],
      observed,
    );
  const stalled = stalledRecordPath(location.records, id);
  const observer = observationWriter((next) => {
    observed = next;
    record();
  });
  const fail = (detail: string) => {
    failed = true;
    channelIssue = { code: "event_channel_unavailable", detail };
    record();
  };
  /** Keeps the ping file bounded; an append that races the truncation still notified us. */
  const bound = () => {
    try {
      if (statSync(ping).size > PING_FILE_BOUND_BYTES) truncateSync(ping, 0);
    } catch {
      // Removed meanwhile; the next check rebuilds it.
    }
  };
  const open = (): boolean => {
    const refused = prepareChannelDirectory(databasePath, location.run);
    if (refused !== null) {
      channelIssue = { code: "event_channel_refused", detail: refused };
      return false;
    }
    sweepDeadChannels(location);
    try {
      // The lock is held with an exclusive share mode until exit: it is the proof of life.
      lockDescriptor ??= openSync(
        lock,
        constants.O_RDWR | constants.O_CREAT | exclusiveLockFlag(),
        0o600,
      );
      writeFileSync(ping, "", { flag: "a", mode: 0o600 });
      watcher = watch(location.run, { persistent: false }, (_event, name) => {
        const entry = name?.toString() ?? null;
        if (closed || (entry !== null && !entry.startsWith(pingName))) return;
        if (lstatOrNull(stalled) !== null) removeRecord(stalled);
        // A writer whose append failed left a separate file; it has served its purpose.
        if (entry !== null && entry !== pingName) removeRecord(join(location.run, entry));
        onPing();
        bound();
      });
      watcher.on("error", (error) => {
        if (closed || failed) return;
        watcher?.close();
        watcher = null;
        fail(`The watch on ${location.run} failed: ${String(error)}.`);
        onUnavailable();
      });
      failed = false;
      channelIssue = null;
      return true;
    } catch (error) {
      watcher?.close();
      watcher = null;
      fail(`The ping file in ${location.run} could not be watched: ${String(error)}.`);
      return false;
    }
  };
  open();
  record();
  return {
    available: () =>
      !closed &&
      !failed &&
      watcher !== null &&
      lstatOrNull(ping) !== null &&
      lockDescriptor !== null,
    close: () => {
      closed = true;
      observer.cancel();
      watcher?.close();
      if (lockDescriptor !== null) closeSync(lockDescriptor);
      removeRecord(ping);
      removeRecord(lock);
      removeRecord(subscriberRecordPath(location.records, id));
    },
    verify: () => {
      if (closed) return false;
      if (!failed && watcher !== null && lstatOrNull(ping) !== null && lstatOrNull(lock) !== null) {
        if (lstatOrNull(subscriberRecordPath(location.records, id)) === null) record();
        return false;
      }
      watcher?.close();
      watcher = null;
      if (lstatOrNull(lock) === null && lockDescriptor !== null) {
        closeSync(lockDescriptor);
        lockDescriptor = null;
      }
      const rebuilt = open();
      record();
      return rebuilt;
    },
    report: (issues) => {
      watchIssues = [...issues];
      record();
    },
    observe: (seq) => observer.observe(seq),
    // The directory watch delivers each append as its own notification.
    pending: () => false,
  };
}
