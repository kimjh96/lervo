import { watch, type FSWatcher } from "node:fs";

/** A writer-side channel as the change-token watch drives it. */
export interface ChangeTokenChannel {
  close(): void;
  /** Whether pings can reach this watch now; absent means always. */
  available?(): boolean;
  /** Rebuilds the channel when it failed or was removed; true when it was rebuilt. */
  verify?(): boolean;
  /** Takes a ping that arrived but was not delivered yet, without blocking. */
  pending?(): boolean;
}

/** What the watch reports as visible state (ADR-0602). */
export interface ChangeTokenWatchHealth {
  /** No writer-side channel could be armed; the reason is recorded by the channel itself. */
  channelUnavailable: boolean;
  /** The kernel directory watch could not be armed or failed. */
  detectorUnavailable: boolean;
  /** A change arrived through the directory watch with no ping: a writer that does not ping. */
  writerWithoutPing: boolean;
}

/**
 * ADR-0602: the one change-driven wait for resident and Node watchers. It never polls. Writers
 * ping the channel synchronously after each commit, so the channel alone wakes the watch for
 * every pinging writer. The kernel directory watch is a detector: a change it sees without a ping
 * still wakes the watch and raises `writerWithoutPing` until a change arrives with a ping.
 *
 * Both sources are armed before the first token read, so a change racing the subscription is
 * seen. A burst of signals becomes one token read (50 ms one-shot debounce). An unreadable token
 * counts as a change. A failed source reads the token once and notifies.
 */
export interface ChangeTokenWatchOptions {
  /** Starts the writer-side channel; returns null when it cannot start. */
  channel?: (ping: () => void, unavailable: () => void) => ChangeTokenChannel | null;
  /** Directory whose kernel notifications reveal a change, pinged or not. */
  directory?: string;
  /** Entry names in `directory` that matter; omit to accept every entry. */
  entries?: readonly string[];
  /** Receives the visible state whenever it changes. */
  onHealth?: (health: ChangeTokenWatchHealth) => void;
  /** Runs after the first token read and after every check: once per wake, never idle. */
  onChecked?: () => void;
  debounceMilliseconds?: number;
}

export function watchChangeToken(
  token: () => string | null,
  notify: () => void,
  options: ChangeTokenWatchOptions,
): () => void {
  let watcher: FSWatcher | undefined;
  let channel: ChangeTokenChannel | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pinged = false;
  let hinted = false;
  let current: string | null = null;
  const health: ChangeTokenWatchHealth = {
    channelUnavailable: false,
    detectorUnavailable: false,
    writerWithoutPing: false,
  };
  let reported = "";
  const publish = () => {
    const next = JSON.stringify(health);
    if (next === reported) return;
    reported = next;
    options.onHealth?.({ ...health });
  };
  const read = (): { value: string | null; failed: boolean } => {
    try {
      return { value: token(), failed: false };
    } catch {
      return { value: null, failed: true };
    }
  };
  const channelArmed = () => channel !== null && (channel.available?.() ?? true);
  const check = (force: boolean) => {
    if (closed) return;
    // A failed or removed channel is rebuilt; the check below catches up whatever it missed.
    const rebuilt = channel?.verify?.() === true;
    health.channelUnavailable = options.channel !== undefined && !channelArmed();
    const next = read();
    const moved = next.failed || next.value !== current;
    if (!next.failed) current = next.value;
    const sawPing = pinged;
    const sawHint = hinted;
    pinged = false;
    hinted = false;
    if (moved && sawPing) health.writerWithoutPing = false;
    // A rebuilt channel could not have received a ping for this change, so it proves nothing.
    if (moved && sawHint && !sawPing && !rebuilt && channelArmed()) {
      // A ping written right after the commit may still be queued behind the directory event;
      // the decision waits one turn of the event loop and takes any undelivered ping first.
      setImmediate(() => {
        if (closed) return;
        if (!pinged && channel?.pending?.() !== true) health.writerWithoutPing = true;
        publish();
      });
    }
    publish();
    options.onChecked?.();
    if (moved || force) notify();
  };
  const signal = (kind: "ping" | "hint") => {
    if (closed) return;
    if (kind === "ping") pinged = true;
    else hinted = true;
    if (debounce !== undefined) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      check(false);
    }, options.debounceMilliseconds ?? 50);
    debounce.unref();
  };
  if (options.channel !== undefined) {
    try {
      channel = options.channel(
        () => signal("ping"),
        () => check(true),
      );
    } catch {
      channel = null;
    }
    health.channelUnavailable = !channelArmed();
  }
  if (options.directory !== undefined) {
    try {
      watcher = watch(options.directory, { persistent: false }, (_event, entry) => {
        if (
          options.entries !== undefined &&
          entry !== null &&
          !options.entries.includes(entry.toString())
        )
          return;
        signal("hint");
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
        health.detectorUnavailable = true;
        check(true);
      });
    } catch {
      watcher = undefined;
      health.detectorUnavailable = true;
    }
  }
  // Both sources are armed, so a change after this read is signalled.
  current = read().value;
  publish();
  options.onChecked?.();
  return () => {
    closed = true;
    if (debounce !== undefined) clearTimeout(debounce);
    watcher?.close();
    channel?.close();
  };
}
