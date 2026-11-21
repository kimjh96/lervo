import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eventStoreChannelLocation } from "./change-channel-layout.js";
import { runEntries, writeRecord } from "./change-channel-state.js";

/**
 * ADR-0602: the commit-time ring. Writers record when each recent commit's events were committed,
 * by this host's clock; inspection reads it to tell how long a subscriber left an event unseen.
 */
export const COMMIT_TIMES_KEPT = 64;

export interface CommitTime {
  from: number;
  to: number;
  /** Epoch milliseconds just before the commit, on the committing host. */
  at: number;
}

export const commitTimesPath = (records: string) => join(records, "commit-times.json");

export function readCommitTimes(path: string): CommitTime[] {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is CommitTime =>
            typeof entry === "object" &&
            entry !== null &&
            Number.isSafeInteger((entry as CommitTime).from) &&
            Number.isSafeInteger((entry as CommitTime).to) &&
            Number.isFinite((entry as CommitTime).at),
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * The latest moment the event at `seq` can have been committed: its own entry, or else the first
 * later entry's time, since it was committed before that one (an older event, or a gap a writer
 * that keeps no ring left). A stall is then judged no sooner than it is due. Null when no entry
 * is at or after `seq`.
 */
export function committedBy(times: readonly CommitTime[], seq: number): number | null {
  let later: number | null = null;
  for (const entry of times) {
    if (seq >= entry.from && seq <= entry.to) return entry.at;
    if (entry.from > seq && (later === null || entry.at < later)) later = entry.at;
  }
  return later;
}

/**
 * Records one commit's sequence range and time. It runs inside the transaction, before COMMIT,
 * while SQLite's write lock serializes every writer, so no two writers race on the ring. A commit
 * that then fails leaves an entry the next commit of the same sequences replaces. It is written
 * only while subscribers exist and keeps the last 64 commits. Never throws.
 */
export function recordCommitTime(
  databasePath: string,
  committed: { from: number; to: number },
): void {
  try {
    const location = eventStoreChannelLocation(databasePath);
    if (runEntries(location.run).length === 0) return;
    const path = commitTimesPath(location.records);
    const entries = readCommitTimes(path).filter(
      (entry) => entry.to < committed.from || entry.from > committed.to,
    );
    entries.push({ ...committed, at: Date.now() });
    entries.sort((left, right) => left.from - right.from);
    writeRecord(path, entries.slice(-COMMIT_TIMES_KEPT));
  } catch {
    // The ring only sharpens stall detection; a write never depends on it.
  }
}
