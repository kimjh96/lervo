import type { EventStoreChannelIssue } from "./change-channel-state.js";

/** ADR-0602: one subscriber's end of the event-store wake channel. */
export interface EventStoreChannelListener {
  /** Whether pings can reach this subscriber now. */
  available(): boolean;
  close(): void;
  /**
   * Rebuilds the channel when it failed, was removed or replaced, and rewrites its record if
   * something removed it; returns whether the channel was rebuilt.
   */
  verify(): boolean;
  /** Records this subscriber's watch issues next to its own channel issues. */
  report(issues: readonly EventStoreChannelIssue[]): void;
  /**
   * Records the head sequence this subscriber just observed, once per wake, so inspection can
   * tell a subscriber that stopped waking from one with nothing to do.
   */
  observe(seq: number | null): void;
  /** Takes a ping that arrived but was not delivered yet, without blocking. */
  pending(): boolean;
}

/** The observed head is written at most this often (ADR-0602). */
const OBSERVATION_WRITE_MILLISECONDS = 1_000;

/**
 * Writes the observed head only when it changed, at most once a second. A change inside that
 * second is written by one one-shot timer at its end, armed only by a wake, so the record never
 * lags the head the subscriber has actually seen.
 */
export function observationWriter(write: (observed: { seq: number; at: number }) => void): {
  observe(seq: number | null): void;
  cancel(): void;
} {
  let written: number | null = null;
  let writtenAt = 0;
  let latest: { seq: number; at: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (latest === null || latest.seq === written) return;
    written = latest.seq;
    writtenAt = Date.now();
    write(latest);
  };
  return {
    observe: (seq) => {
      if (seq === null) return;
      latest = { seq, at: Date.now() };
      if (seq === written || timer !== null) return;
      const wait = writtenAt + OBSERVATION_WRITE_MILLISECONDS - Date.now();
      if (wait <= 0) flush();
      else {
        timer = setTimeout(flush, wait);
        timer.unref();
      }
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
