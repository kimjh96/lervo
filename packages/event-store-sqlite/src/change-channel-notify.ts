import {
  appendFileSync,
  writeFileSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  renameSync,
  writeSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import {
  checkChannelDirectory,
  eventStoreChannelLocation,
  FIFO_SUFFIX,
  lstatOrNull,
  owner,
  parseSubscriberId,
  LOCK_SUFFIX,
  PING_SUFFIX,
  WINDOWS,
  windowsLockState,
} from "./change-channel-layout.js";
import {
  removeRecord,
  removeSubscriberTraces,
  runEntries,
  stalledRecordPath,
  unreachableRecordPath,
  writeRecord,
} from "./change-channel-state.js";
import { kernelRelation } from "./process-identity.js";

/**
 * ADR-0602: pings every subscriber of `databasePath` after a commit. It is synchronous, so each
 * byte is in the kernel's pipe buffer before `transact` returns, and it never blocks or throws.
 */
export function notifyEventStoreChange(databasePath: string): void {
  try {
    if (WINDOWS) notifyWindows(databasePath);
    else notifyUnix(databasePath);
  } catch {
    // The commit already succeeded; a channel problem is reported by inspection, not thrown.
  }
}

const writerUid = () => String(process.getuid?.() ?? "windows");

/** Records a finding about one subscriber once, and clears it once it no longer holds. */
function note(
  path: string,
  finding: { subscriber: string; code: string; detail: string } | null,
): void {
  if (finding === null) {
    if (lstatOrNull(path) !== null) removeRecord(path);
  } else if (lstatOrNull(path) === null) writeRecord(path, finding);
}

/**
 * Removes a FIFO proven unread (ENXIO). It is first renamed to a private tombstone, so a FIFO a new
 * subscriber put in its place is restored instead of removed.
 */
function removeDeadFifo(path: string, seen: Stats): boolean {
  const tombstone = `${path}.${randomBytes(6).toString("hex")}.dead`;
  try {
    renameSync(path, tombstone);
  } catch {
    return false;
  }
  const moved = lstatOrNull(tombstone);
  if (moved !== null && moved.ino === seen.ino && moved.isFIFO()) {
    removeRecord(tombstone);
    return true;
  }
  try {
    renameSync(tombstone, path);
  } catch {
    // The original name was taken again meanwhile; the newer subscriber keeps it.
  }
  return false;
}

/** Whether ENXIO from this kernel can prove the subscriber gone: this host, or this kernel. */
export function provable(parsed: { host: string; boot: string }): boolean {
  const relation = kernelRelation(parsed.host, parsed.boot);
  return relation === "same_kernel" || relation === "other_boot";
}

/**
 * Every FIFO is pinged, whatever its identity: a FIFO only opens when a reader on this kernel
 * holds it, so pinging one of another host costs nothing and an unknown identity loses no wake.
 */
function notifyUnix(databasePath: string): void {
  const location = eventStoreChannelLocation(databasePath);
  const directory = location.run;
  // A missing run directory means no subscriber has started; a refused one is never written into.
  if (lstatOrNull(directory) === null || checkChannelDirectory(databasePath, directory) !== null)
    return;
  const directoryUid = owner(directory);
  for (const name of runEntries(directory)) {
    if (!name.endsWith(FIFO_SUFFIX)) continue;
    const subscriber = name.slice(0, -FIFO_SUFFIX.length);
    const parsed = parseSubscriberId(subscriber);
    if (parsed === null) continue;
    const path = join(directory, name);
    const stats = lstatOrNull(path);
    if (stats === null || !stats.isFIFO() || stats.uid !== directoryUid) continue;
    const unreachable = unreachableRecordPath(location.records, subscriber, writerUid());
    let descriptor: number;
    try {
      descriptor = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENXIO") {
        // Nobody on this kernel reads it. That proves its subscriber gone only for a FIFO of this
        // host (any boot) or this kernel; another host's or an unidentifiable one is kept.
        if (provable(parsed) && removeDeadFifo(path, stats))
          removeSubscriberTraces(location.records, directory, subscriber);
      } else if (code !== "ENOENT")
        note(unreachable, {
          subscriber,
          code: "event_channel_subscriber_unreachable",
          detail: `uid ${writerUid()} cannot open ${name}: ${code ?? "unknown"}. Run Lervo for this repository as the database owner.`,
        });
      continue;
    }
    try {
      if (!fstatSync(descriptor).isFIFO()) continue;
      writeSync(descriptor, "1");
      note(stalledRecordPath(location.records, subscriber), null);
      note(unreachable, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // EAGAIN: unread pings fill the buffer, so the subscriber will wake, but it is not reading.
      if (code === "EAGAIN")
        note(stalledRecordPath(location.records, subscriber), {
          subscriber,
          code: "event_channel_subscriber_stalled",
          detail: `Subscriber ${subscriber} has not read its pings; its process may be stopped or blocked.`,
        });
      else
        note(unreachable, {
          subscriber,
          code: "event_channel_subscriber_unreachable",
          detail: `uid ${writerUid()} cannot write ${name}: ${code ?? "unknown"}.`,
        });
    } finally {
      closeSync(descriptor);
    }
  }
}

/**
 * Windows: appends one byte to each live subscriber's ping file in the user's private run
 * directory; the subscriber's directory watch sees the change. A plain file write cannot be used
 * to impersonate the writer, unlike a named pipe client connection.
 */
function notifyWindows(databasePath: string): void {
  const location = eventStoreChannelLocation(databasePath);
  for (const name of runEntries(location.run)) {
    if (!name.endsWith(PING_SUFFIX)) continue;
    const subscriber = name.slice(0, -PING_SUFFIX.length);
    const parsed = parseSubscriberId(subscriber);
    if (parsed === null) continue;
    const ping = join(location.run, name);
    const lock = join(location.run, `${subscriber}${LOCK_SUFFIX}`);
    // A free lock proves its subscriber gone, but only for this host; others are kept.
    if (provable(parsed) && windowsLockState(lock) !== "held") {
      removeRecord(lock);
      removeRecord(ping);
      removeSubscriberTraces(location.records, location.run, subscriber);
      continue;
    }
    const unreachable = unreachableRecordPath(location.records, subscriber, writerUid());
    if (appendPing(ping)) {
      note(unreachable, null);
      continue;
    }
    // The append failed twice (a sharing violation, a full disk): a new file next to the ping file
    // still raises the directory notification the subscriber waits for.
    try {
      writeFileSync(`${ping}.${randomBytes(6).toString("hex")}`, "1", { flag: "wx", mode: 0o600 });
      note(unreachable, null);
    } catch (error) {
      note(unreachable, {
        subscriber,
        code: "event_channel_subscriber_unreachable",
        detail: `This process cannot write next to ${name}: ${(error as NodeJS.ErrnoException).code ?? "unknown"}. Run Lervo for this repository as its owner.`,
      });
    }
  }
}

/** Appends one byte, retrying once. */
function appendPing(path: string): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1)
    try {
      appendFileSync(path, "1");
      return true;
    } catch {
      // Retried once.
    }
  return false;
}
