import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readSync, renameSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";

import {
  eventStoreChannelLocation,
  FIFO_SUFFIX,
  lstatOrNull,
  prepareChannelDirectory,
  WINDOWS,
} from "./change-channel-layout.js";
import {
  removeRecord,
  stalledRecordPath,
  subscriberRecordPath,
  writeSubscriberRecord,
  type EventStoreChannelIssue,
} from "./change-channel-state.js";
import { sweepDeadChannels } from "./change-channel-inspection.js";
import { observationWriter, type EventStoreChannelListener } from "./change-channel-listener.js";
import { listenWindows } from "./change-channel-windows.js";
import { localBootKey, localHostKey } from "./process-identity.js";

/**
 * ADR-0602: the writer-side wake channel of one event database.
 *
 * Every subscriber owns one FIFO `<boot>-<pid>-<nonce>.fifo` in the database's run directory and
 * holds it open for reading for as long as it lives. After each commit a writer opens each FIFO of
 * its own kernel non-blocking, writes one byte and closes it, all synchronously, so the byte is
 * in the kernel's pipe buffer before `transact` returns. ENXIO on that open proves no process on
 * this kernel reads it. The boot key keeps a FIFO shared over NFS or a VM mount from being judged
 * by another kernel. On Windows a subscriber watches its own ping file in the same private run
 * directory, which writers append to; no client connection, so nothing can impersonate a writer.
 *
 * A subscriber records its presence and issues in the channel records, so a lost or refused
 * channel is visible (`inspectEventStoreChannel`). This module imports only Node built-ins.
 */
export { eventStoreChannelDirectory, eventStoreChannelLocation } from "./change-channel-layout.js";
export { notifyEventStoreChange } from "./change-channel-notify.js";
export { inspectEventStoreChannel } from "./change-channel-inspection.js";
export type { EventStoreChannelListener } from "./change-channel-listener.js";
export type { EventStoreChannelIssue, EventStoreChannelIssueCode } from "./change-channel-state.js";

/** Absolute paths first, so a missing PATH entry is told apart from a missing tool. */
const MKFIFO = ["/usr/bin/mkfifo", "/bin/mkfifo", "mkfifo"] as const;

export interface EventStoreChannelListenOptions {
  /** Test seam: the mkfifo tools tried in order. */
  mkfifo?: readonly string[];
}

function createFifo(path: string, tools: readonly string[]): EventStoreChannelIssue | null {
  let missing = 0;
  for (const tool of tools) {
    try {
      // Node has no mkfifo; the system tool runs once per subscription, never per commit.
      execFileSync(tool, ["-m", "600", path], { stdio: "ignore" });
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing += 1;
        continue;
      }
      return {
        code: "event_channel_unsupported",
        detail: `mkfifo failed in ${path}: ${(error as Error).message.split("\n")[0]}. Move the repository to a filesystem that supports named pipes.`,
      };
    }
  }
  return missing === tools.length
    ? {
        code: "event_channel_mkfifo_missing",
        detail: "No mkfifo tool was found in /usr/bin, /bin or PATH. Install coreutils.",
      }
    : null;
}

/**
 * Listens for pings on `databasePath`. `onPing` runs once per received chunk; `onUnavailable` runs
 * when a working channel fails. The listener always exists, so a channel that cannot start is
 * recorded, reported and retried by `verify`.
 */
export function listenEventStoreChanges(
  databasePath: string,
  onPing: () => void,
  onUnavailable: () => void,
  options: EventStoreChannelListenOptions = {},
): EventStoreChannelListener {
  return WINDOWS
    ? listenWindows(databasePath, onPing, onUnavailable)
    : listenUnix(databasePath, onPing, onUnavailable, options.mkfifo ?? MKFIFO);
}

function listenUnix(
  databasePath: string,
  onPing: () => void,
  onUnavailable: () => void,
  tools: readonly string[],
): EventStoreChannelListener {
  const location = eventStoreChannelLocation(databasePath);
  const id = `${localHostKey()}-${localBootKey()}-${process.pid}-${randomBytes(8).toString("hex")}`;
  const path = join(location.run, `${id}${FIFO_SUFFIX}`);
  let closed = false;
  let failed = false;
  let reader: Socket | null = null;
  let readDescriptor: number | null = null;
  let inode: number | null = null;
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

  const open = (): boolean => {
    const refused = prepareChannelDirectory(databasePath, location.run);
    if (refused !== null) {
      channelIssue = { code: "event_channel_refused", detail: refused };
      return false;
    }
    sweepDeadChannels(location);
    const temporary = join(location.run, `.${id}.${randomBytes(4).toString("hex")}.tmp`);
    const created = createFifo(temporary, tools);
    if (created !== null) {
      channelIssue = created;
      return false;
    }
    let descriptor: number | null = null;
    try {
      // Read and write access keeps the FIFO open with no writer, so it never reads end of file.
      descriptor = openSync(
        temporary,
        constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOFOLLOW,
      );
      // Writers see the final name only once it is held open.
      renameSync(temporary, path);
      inode = lstatSync(path).ino;
      const socket = new Socket({ fd: descriptor, readable: true, writable: false });
      readDescriptor = descriptor;
      descriptor = null;
      socket.unref();
      socket.on("data", () => {
        if (closed) return;
        // Reading again clears any stall a writer recorded about this subscriber.
        if (lstatOrNull(stalled) !== null) removeRecord(stalled);
        onPing();
      });
      socket.on("error", () => {
        if (closed || failed) return;
        failed = true;
        channelIssue = {
          code: "event_channel_unavailable",
          detail: `${path} failed while reading.`,
        };
        record();
        onUnavailable();
      });
      reader = socket;
      channelIssue = null;
      return true;
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      rmSync(temporary, { force: true });
      channelIssue = {
        code: "event_channel_unavailable",
        detail: `A FIFO in ${location.run} could not be held open: ${String(error)}.`,
      };
      return false;
    }
  };
  open();
  record();
  return {
    available: () => !closed && !failed && reader !== null && !reader.destroyed,
    close: () => {
      closed = true;
      observer.cancel();
      reader?.destroy();
      readDescriptor = null;
      removeRecord(path);
      removeRecord(subscriberRecordPath(location.records, id));
    },
    verify: () => {
      if (closed) return false;
      const current = lstatOrNull(path);
      const intact =
        !failed &&
        reader !== null &&
        !reader.destroyed &&
        current !== null &&
        current.isFIFO() &&
        current.ino === inode;
      if (intact) {
        // A state reset moves derived state away; the record comes back at the next check.
        if (lstatOrNull(subscriberRecordPath(location.records, id)) === null) record();
        return false;
      }
      reader?.destroy();
      reader = null;
      readDescriptor = null;
      if (current !== null && current.ino === inode) removeRecord(path);
      failed = false;
      const rebuilt = open();
      record();
      return rebuilt;
    },
    report: (issues) => {
      watchIssues = [...issues];
      record();
    },
    observe: (seq) => observer.observe(seq),
    pending: () => {
      if (readDescriptor === null || closed) return false;
      try {
        return readSync(readDescriptor, Buffer.alloc(4_096)) > 0;
      } catch {
        // EAGAIN: nothing is waiting.
        return false;
      }
    },
  };
}
