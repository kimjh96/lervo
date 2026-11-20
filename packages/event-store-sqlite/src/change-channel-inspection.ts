import { closeSync, constants, openSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkChannelDirectory,
  eventStoreChannelLocation,
  FIFO_SUFFIX,
  LOCK_SUFFIX,
  lstatOrNull,
  parseSubscriberId,
  PING_SUFFIX,
  RECORD_SUFFIX,
  WINDOWS,
  windowsLockState,
} from "./change-channel-layout.js";
import { commitTimesPath, committedBy, readCommitTimes } from "./change-channel-commit-times.js";
import {
  removeRecord,
  removeSubscriberTraces,
  type EventStoreChannelIssue,
  type EventStoreChannelIssueCode,
  type SubscriberRecord,
} from "./change-channel-state.js";
import {
  kernelRelation,
  localProcessAlive,
  type KernelRelation,
  type LocalProcessIdentity,
} from "./process-identity.js";

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Whether a subscriber FIFO is held open for reading: it opens and closes it, writing nothing.
 * Only ENXIO (no reader) or ENOENT proves it gone; a FIFO this user cannot open may still live.
 */
function fifoHeld(path: string): boolean {
  try {
    closeSync(openSync(path, constants.O_WRONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== "ENXIO" && code !== "ENOENT";
  }
}

/**
 * Whether a subscriber lives, by the rules of `kernelRelation`: on this kernel by its FIFO or
 * Windows lock, else by its process; a subscriber of another boot of this host is gone; one of
 * another host or with an unknown key cannot be judged and counts as alive, so nothing is hidden.
 */
function subscriberState(
  run: string,
  subscriber: string,
  identity: LocalProcessIdentity | null,
): { alive: boolean; provenGone: boolean; reachable: boolean; relation: KernelRelation } {
  const parsed = parseSubscriberId(subscriber);
  const relation =
    parsed === null
      ? identity === null
        ? "unknown"
        : kernelRelation(identity.host, identity.boot)
      : kernelRelation(parsed.host, parsed.boot);
  if (relation === "foreign" || relation === "unknown")
    return { alive: true, provenGone: false, reachable: false, relation };
  // This host or kernel: the FIFO or lock is exact proof, whatever the boot key says.
  if (WINDOWS) {
    const lock = windowsLockState(join(run, `${subscriber}${LOCK_SUFFIX}`));
    return {
      alive: lock === "held",
      provenGone: lock !== "held",
      reachable: lock === "held",
      relation,
    };
  }
  const fifo = join(run, `${subscriber}${FIFO_SUFFIX}`);
  if (lstatOrNull(fifo)?.isFIFO() === true) {
    const held = fifoHeld(fifo);
    return { alive: held, provenGone: !held, reachable: held, relation };
  }
  // No FIFO to prove it: another boot removes only records, which a live subscriber rewrites.
  if (relation === "other_boot")
    return { alive: false, provenGone: true, reachable: false, relation };
  const known = identity === null ? null : localProcessAlive(identity);
  return { alive: known !== false, provenGone: known === false, reachable: false, relation };
}

/** A subscriber no ping has woken for longer than this, with a commit waiting, is stalled. */
export const EVENT_CHANNEL_STALL_MILLISECONDS = 30_000;

/** What inspection may read from the store to tell a stalled subscriber (ADR-0602). */
export interface EventStoreChannelHistory {
  /** The stored head's sequence, or null for an empty store. */
  headSeq(): number | null;
}

/**
 * ADR-0602: every visible problem of the channel of `databasePath`, for health and attention. With
 * `history`, a subscriber whose last observed head is behind the store's, for an event committed
 * (by the writers' commit-time ring, not the event's own time) longer than the stall bound ago,
 * is reported stalled. Records of subscribers proven gone (an
 * ENXIO, a released lock, another boot of this host or a dead process) are removed.
 */
export function inspectEventStoreChannel(
  databasePath: string,
  options: { history?: EventStoreChannelHistory; now?: number } = {},
): EventStoreChannelIssue[] {
  const location = eventStoreChannelLocation(databasePath);
  const now = options.now ?? Date.now();
  const issues: EventStoreChannelIssue[] = [];
  let runNames: string[] = [];
  const runState = lstatOrNull(location.run);
  if (runState !== null) {
    const reason = WINDOWS ? null : checkChannelDirectory(databasePath, location.run);
    if (reason !== null) issues.push({ code: "event_channel_refused", detail: reason });
    else
      try {
        runNames = readdirSync(location.run);
      } catch (error) {
        issues.push({ code: "event_channel_refused", detail: `${location.run}: ${String(error)}` });
      }
  }
  for (const name of runNames) {
    const suffix = name.endsWith(FIFO_SUFFIX)
      ? FIFO_SUFFIX
      : name.endsWith(PING_SUFFIX)
        ? PING_SUFFIX
        : null;
    if (suffix === null) continue;
    const subscriber = name.slice(0, -suffix.length);
    const parsed = parseSubscriberId(subscriber);
    const relation = parsed === null ? "unknown" : kernelRelation(parsed.host, parsed.boot);
    if (relation === "same_kernel" || relation === "other_boot") {
      // This host's own: removed only with exact proof (ENXIO or a free lock).
      if (removeProvenGone(location, name, suffix, subscriber)) continue;
    } else if (relation === "foreign")
      issues.push({
        code: "event_channel_foreign_host",
        detail: `${name} belongs to a subscriber on another host sharing this repository; this host's writes cannot wake it. Run the Lervo services for a checkout on one host.`,
      });
    else if (relation === "unknown")
      issues.push({
        code: "event_channel_identity_unknown",
        detail: `${name} or this host has no readable host or boot identity, so it is never removed. Pings still reach it on its own kernel; if it belongs to an exited subscriber, remove it after stopping the Lervo services.`,
      });
  }
  let recordNames: string[] = [];
  try {
    recordNames = readdirSync(location.records);
  } catch {
    // No records: no subscriber or writer reported anything.
  }
  let runningWithoutRun = false;
  const headSeq = options.history?.headSeq() ?? null;
  const commitTimes = headSeq === null ? [] : readCommitTimes(commitTimesPath(location.records));
  for (const name of recordNames) {
    if (!name.endsWith(RECORD_SUFFIX)) continue;
    const value = readJson(join(location.records, name)) as
      (Partial<SubscriberRecord> & { code?: unknown; detail?: unknown }) | null;
    if (value === null) continue;
    const subscriber =
      typeof value.subscriber === "string"
        ? value.subscriber
        : /^(?:stalled|unreachable)-(.+?)(?:-[0-9]+|-windows)?\.json$/u.exec(name)?.[1];
    if (subscriber === undefined) continue;
    const state = subscriberState(
      location.run,
      subscriber,
      (value.identity as LocalProcessIdentity | undefined) ?? null,
    );
    if (state.provenGone) {
      removeSubscriberTraces(location.records, location.run, subscriber);
      continue;
    }
    if (!name.startsWith("subscriber-")) {
      if (typeof value.code === "string")
        issues.push({
          code: value.code as EventStoreChannelIssueCode,
          detail: String(value.detail),
        });
      continue;
    }
    const own = (value.issues as EventStoreChannelIssue[] | undefined) ?? [];
    issues.push(...own);
    // A subscriber that already names why it has no channel needs no second issue.
    const explained = own.some((issue) => CHANNEL_CAUSES.has(issue.code));
    if (runState === null) runningWithoutRun = true;
    else if (!state.reachable && state.relation === "same_kernel" && !explained)
      issues.push({
        code: "event_channel_unavailable",
        detail: `Subscriber ${subscriber} is running but has no FIFO in ${location.run}.`,
      });
    const observed = value.observed;
    if (
      headSeq !== null &&
      observed !== undefined &&
      state.relation === "same_kernel" &&
      headSeq > observed.seq &&
      now - observed.at > EVENT_CHANNEL_STALL_MILLISECONDS
    ) {
      const waitingSince = committedBy(commitTimes, observed.seq + 1);
      if (waitingSince !== null && now - waitingSince > EVENT_CHANNEL_STALL_MILLISECONDS)
        issues.push({
          code: "event_channel_subscriber_stalled",
          detail: `Subscriber ${subscriber} last observed event ${observed.seq}; event ${observed.seq + 1} has waited ${Math.round((now - waitingSince) / 1000)} s. Its process may be stopped or blocked.`,
        });
    }
  }
  if (runningWithoutRun)
    issues.push({
      code: "event_channel_unavailable",
      detail: `${location.run} is missing while subscribers are running; restart the Lervo services.`,
    });
  return issues;
}

/**
 * Removes one channel file of this host whose subscriber is proven gone: a FIFO nobody on this
 * kernel reads (ENXIO), or a Windows ping file or lock whose lock opens exclusively. A boot key
 * never decides alone, because a clock step can make a live boot look like another.
 */
function removeProvenGone(
  location: { run: string; records: string },
  name: string,
  suffix: string,
  subscriber: string,
): boolean {
  const path = join(location.run, name);
  const gone =
    suffix === FIFO_SUFFIX
      ? !fifoHeld(path)
      : windowsLockState(join(location.run, `${subscriber}${LOCK_SUFFIX}`)) !== "held";
  if (!gone) return false;
  removeRecord(path);
  if (suffix !== FIFO_SUFFIX) removeRecord(join(location.run, `${subscriber}${LOCK_SUFFIX}`));
  removeSubscriberTraces(location.records, location.run, subscriber);
  return true;
}

/**
 * Removes every channel file of this host proven gone, with its records; a subscriber runs it
 * when it starts, and writers and inspection apply the same rule.
 */
export function sweepDeadChannels(location: { run: string; records: string }): void {
  let names: string[];
  try {
    names = readdirSync(location.run);
  } catch {
    return;
  }
  for (const name of names) {
    const suffix = [FIFO_SUFFIX, PING_SUFFIX].find((item) => name.endsWith(item));
    if (suffix === undefined) continue;
    const subscriber = name.slice(0, -suffix.length);
    const parsed = parseSubscriberId(subscriber);
    if (parsed === null) continue;
    const relation = kernelRelation(parsed.host, parsed.boot);
    if (relation === "same_kernel" || relation === "other_boot")
      removeProvenGone(location, name, suffix, subscriber);
  }
}

const CHANNEL_CAUSES = new Set<EventStoreChannelIssueCode>([
  "event_channel_refused",
  "event_channel_unavailable",
  "event_channel_unsupported",
  "event_channel_mkfifo_missing",
]);
