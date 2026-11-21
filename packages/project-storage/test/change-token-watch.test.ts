import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchChangeToken, type ChangeTokenWatchHealth } from "../src/change-token-watch.js";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function watchedDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "lervo-change-token-"));
  directories.push(path);
  return path;
}

/** A channel the test drives by hand, as an event-store commit would. */
function manualChannel(options: { verify?: () => boolean; pending?: () => boolean } = {}) {
  let failed = false;
  const channel = {
    ping: () => undefined as void,
    /** The channel fails, as a FIFO read error would. */
    unavailable: () => undefined as void,
  };
  const close = vi.fn();
  const start = vi.fn((ping: () => void, unavailable: () => void) => {
    channel.ping = ping;
    channel.unavailable = () => {
      failed = true;
      unavailable();
    };
    return {
      close,
      available: () => !failed,
      ...(options.verify === undefined ? {} : { verify: options.verify }),
      ...(options.pending === undefined ? {} : { pending: options.pending }),
    };
  });
  return { channel, start, close };
}

describe("change-token watch (ADR-0602)", () => {
  it("reads no token and wakes nobody while idle, however long it waits", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval"] });
    const token = vi.fn(() => "head");
    const notify = vi.fn();
    const { start } = manualChannel();
    const stop = watchChangeToken(token, notify, { channel: start });
    try {
      expect(token).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(token).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
    }
  });

  it("arms the channel before its first token read, so a racing commit is never lost", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let value = "before";
    const order: string[] = [];
    const notify = vi.fn();
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(
      () => {
        order.push(`read:${value}`);
        return value;
      },
      notify,
      {
        channel: (ping, unavailable) => {
          order.push("armed");
          // A commit lands while the subscription starts: the first read already includes it.
          value = "during";
          return start(ping, unavailable);
        },
      },
    );
    try {
      expect(order).toEqual(["armed", "read:during"]);
      // A commit right after the subscription returns wakes it through the armed channel.
      value = "after";
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("reads the token once per burst of pings and notifies only on a change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let value = "a";
    const token = vi.fn(() => value);
    const notify = vi.fn();
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(token, notify, { channel: start });
    try {
      token.mockClear();
      channel.ping();
      channel.ping();
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(token).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
      value = "b";
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
    }
  });

  it("reports a change seen only by the directory watch as a writer without ping", async () => {
    const directory = await watchedDirectory();
    let value = "a";
    const notify = vi.fn();
    const health: ChangeTokenWatchHealth[] = [];
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(() => value, notify, {
      channel: start,
      directory,
      entries: ["events.sqlite-wal"],
      onHealth: (next) => health.push(next),
    });
    try {
      // An older writer commits: the WAL changes and nothing pings. FSEvents starts its stream
      // asynchronously, so the write repeats inside the wait until the detector has seen one.
      value = "b";
      await vi.waitFor(
        async () => {
          await writeFile(join(directory, "events.sqlite-wal"), "commit");
          expect(notify).toHaveBeenCalledTimes(1);
        },
        { timeout: 5_000 },
      );
      // The flag is decided one event-loop turn later, so a queued ping could still clear it.
      await vi.waitFor(() => expect(health.at(-1)?.writerWithoutPing).toBe(true), {
        timeout: 5_000,
      });
      // A pinging writer commits: the state clears.
      value = "c";
      channel.ping();
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2), { timeout: 5_000 });
      expect(health.at(-1)?.writerWithoutPing).toBe(false);
    } finally {
      stop();
    }
  });

  it("takes an undelivered ping before judging, and never judges right after a rebuild", async () => {
    for (const variant of ["pending", "rebuilt"] as const) {
      const directory = await watchedDirectory();
      let value = "a";
      const notify = vi.fn();
      const health: ChangeTokenWatchHealth[] = [];
      const { start } = manualChannel(
        variant === "pending" ? { pending: () => true } : { verify: () => true },
      );
      const stop = watchChangeToken(() => value, notify, {
        channel: start,
        directory,
        entries: ["events.sqlite-wal"],
        onHealth: (next) => health.push(next),
        onChecked: vi.fn(),
      });
      try {
        value = "b";
        // The write repeats inside the wait, as above, until the detector has seen one.
        await vi.waitFor(
          async () => {
            await writeFile(join(directory, "events.sqlite-wal"), "commit");
            expect(notify).toHaveBeenCalledTimes(1);
          },
          { timeout: 5_000 },
        );
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        expect(health.some((entry) => entry.writerWithoutPing)).toBe(false);
      } finally {
        stop();
      }
    }
  });

  it("runs its checked hook once at subscribe and once per wake, never while idle", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const checked = vi.fn();
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(() => "head", vi.fn(), { channel: start, onChecked: checked });
    try {
      expect(checked).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(checked).toHaveBeenCalledTimes(1);
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(checked).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it("reports when neither source can be armed instead of waiting silently", () => {
    const health: ChangeTokenWatchHealth[] = [];
    const stop = watchChangeToken(() => "head", vi.fn(), {
      channel: () => null,
      directory: join(tmpdir(), "lervo-missing-directory-for-watch"),
      onHealth: (next) => health.push(next),
    });
    stop();
    expect(health).toEqual([
      { channelUnavailable: true, detectorUnavailable: true, writerWithoutPing: false },
    ]);
  });

  it("checks once and notifies when the channel fails, then keeps no timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const token = vi.fn(() => "head");
    const notify = vi.fn();
    const health: ChangeTokenWatchHealth[] = [];
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(token, notify, {
      channel: start,
      onHealth: (next) => health.push(next),
    });
    try {
      token.mockClear();
      channel.unavailable();
      expect(token).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(health.at(-1)?.channelUnavailable).toBe(true);
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(token).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
    }
  });

  it("rebuilds a removed channel on its next check and catches up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let value = "a";
    const verify = vi.fn(() => true);
    const notify = vi.fn();
    const { channel, start } = manualChannel({ verify });
    const stop = watchChangeToken(() => value, notify, { channel: start });
    try {
      value = "b";
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("fails open: an unreadable token on a ping notifies", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fail = false;
    const notify = vi.fn();
    const { channel, start } = manualChannel();
    const stop = watchChangeToken(
      () => {
        if (fail) throw new Error("database busy");
        return "head";
      },
      notify,
      { channel: start },
    );
    try {
      fail = true;
      channel.ping();
      await vi.advanceTimersByTimeAsync(100);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("ignores pings once closed and closes its channel", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const token = vi.fn(() => "head");
    const { channel, start, close } = manualChannel();
    const stop = watchChangeToken(token, vi.fn(), { channel: start });
    stop();
    expect(close).toHaveBeenCalledTimes(1);
    token.mockClear();
    channel.ping();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(token).not.toHaveBeenCalled();
  });
});
