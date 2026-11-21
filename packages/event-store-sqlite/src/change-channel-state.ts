import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FIFO_SUFFIX, PING_SUFFIX, RECORD_SUFFIX } from "./change-channel-layout.js";
import { localProcessIdentity, type LocalProcessIdentity } from "./process-identity.js";

/**
 * ADR-0602: the channel's visible state. Each record has one owner: a subscriber records its own
 * issues, and a writer records what it found about one subscriber. Names are unique per owner, so
 * no process clears or freezes another's record. `inspectEventStoreChannel` reports a record only
 * while the subscriber it concerns is alive.
 */
export type EventStoreChannelIssueCode =
  | "event_channel_refused"
  | "event_channel_unavailable"
  | "event_channel_unsupported"
  | "event_channel_mkfifo_missing"
  | "event_channel_writer_without_ping"
  | "event_channel_detector_unavailable"
  | "event_channel_subscriber_unreachable"
  | "event_channel_subscriber_stalled"
  | "event_channel_foreign_host"
  | "event_channel_identity_unknown";

export interface EventStoreChannelIssue {
  code: EventStoreChannelIssueCode;
  detail: string;
}

export interface SubscriberRecord {
  subscriber: string;
  identity: LocalProcessIdentity;
  issues: EventStoreChannelIssue[];
  /** The head sequence this subscriber last observed, and when (ADR-0602 stall detection). */
  observed?: { seq: number; at: number };
}

/** Writes a record through a temporary name unique to this process. Never throws. */
export function writeRecord(path: string, value: unknown): void {
  try {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch {
    // The records directory is unwritable; the service's own health still reports its failure.
  }
}

export function removeRecord(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already absent.
  }
}

export const subscriberRecordPath = (records: string, subscriber: string) =>
  join(records, `subscriber-${subscriber}${RECORD_SUFFIX}`);
export const stalledRecordPath = (records: string, subscriber: string) =>
  join(records, `stalled-${subscriber}${RECORD_SUFFIX}`);
export const unreachableRecordPath = (records: string, subscriber: string, uid: string) =>
  join(records, `unreachable-${subscriber}-${uid}${RECORD_SUFFIX}`);

/**
 * A subscriber's presence and issues. It exists for as long as the subscriber runs, issues or
 * not, so inspection can tell a running subscriber without a FIFO from no subscriber at all.
 */
export function writeSubscriberRecord(
  records: string,
  subscriber: string,
  issues: readonly EventStoreChannelIssue[],
  observed?: { seq: number; at: number },
): void {
  writeRecord(subscriberRecordPath(records, subscriber), {
    subscriber,
    identity: localProcessIdentity(),
    issues: [...issues],
    ...(observed === undefined ? {} : { observed }),
  } satisfies SubscriberRecord);
}

/** Removes every record about a subscriber proven gone, with its leftover temporary files. */
export function removeSubscriberTraces(records: string, run: string, subscriber: string): void {
  for (const [directory, matches] of [
    [records, (name: string) => name.includes(subscriber)],
    [
      run,
      (name: string) =>
        (name.startsWith(`.${subscriber}.`) && name.endsWith(".tmp")) ||
        // A Windows writer's fallback files beside the ping file (ADR-0602).
        name.startsWith(`${subscriber}.ping.`),
    ],
  ] as const) {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    for (const name of names) if (matches(name)) removeRecord(join(directory, name));
  }
}

/** Ping files and FIFOs in the run directory, for Windows and Unix writers. */
export function runEntries(run: string): string[] {
  try {
    return readdirSync(run).filter(
      (name) => name.endsWith(FIFO_SUFFIX) || name.endsWith(PING_SUFFIX),
    );
  } catch {
    return [];
  }
}
