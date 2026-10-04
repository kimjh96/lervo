import { afterEach, expect, it, vi } from "vitest";
import { ConversationChangeLoop } from "../src/conversation-change-loop.js";

afterEach(() => vi.useRealTimers());

it("sleeps when idle, wakes for changes and deadlines, and disposes subscriptions", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  let deadline: number | null = null;
  const stop = vi.fn();
  const cycle = vi.fn(async () => {});
  const loop = new ConversationChangeLoop({
    runCycle: cycle,
    onFailure: vi.fn(),
    intervalMs: 2_000,
    continueOnFailure: true,
    subscribe: (callback) => {
      notify = callback;
      return stop;
    },
    nextWakeupAt: () => deadline,
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(cycle).toHaveBeenCalledTimes(1);
  deadline = Date.now() + 500;
  notify();
  await vi.advanceTimersByTimeAsync(0);
  expect(cycle).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(500);
  expect(cycle).toHaveBeenCalledTimes(3);
  await loop.stop();
  expect(stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces hints during work without overlapping execution or losing the next cycle", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  let finish = () => {};
  const cycle = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const loop = new ConversationChangeLoop({
    runCycle: cycle,
    onFailure: vi.fn(),
    intervalMs: 2_000,
    subscribe: (callback) => {
      notify = callback;
      callback();
      return () => {};
    },
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  notify();
  notify();
  notify();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(cycle).toHaveBeenCalledTimes(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(cycle).toHaveBeenCalledTimes(2);
  await loop.stop();
});

it("uses a bounded classified failure retry without blocking an earlier change hint", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  const cycle = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error("inactive"), { code: "inactive" }))
    .mockResolvedValue(undefined);
  const loop = new ConversationChangeLoop({
    runCycle: cycle,
    onFailure: vi.fn(),
    intervalMs: 2_000,
    failureRetryMs: (error) => ((error as { code?: unknown }).code === "inactive" ? 60_000 : 2_000),
    continueOnFailure: true,
    subscribe: (callback) => {
      notify = callback;
      return () => {};
    },
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(cycle).toHaveBeenCalledOnce();
  notify();
  await vi.advanceTimersByTimeAsync(1);
  expect(cycle).toHaveBeenCalledTimes(2);
  await loop.stop();
});

it("backs off a lapsed deadline while cycles change nothing and resets on a hint or change", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  let changed = false;
  const starts: number[] = [];
  const loop = new ConversationChangeLoop<boolean>({
    runCycle: async () => {
      starts.push(Date.now());
      return changed;
    },
    onFailure: vi.fn(),
    intervalMs: 5_000,
    continueOnFailure: true,
    subscribe: (callback) => {
      notify = callback;
      return () => {};
    },
    nextWakeupAt: () => 0,
    idleBackoff: { baseMs: 5_000, ceilingMs: 300_000, unchanged: (result) => !result },
  });
  const gaps = () => starts.slice(1).map((start, index) => start - starts[index]!);
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 40_000 + 80_000 + 160_000 + 600_000);
  expect(gaps()).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);

  // A hint runs at once and restarts the sequence.
  starts.length = 0;
  notify();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(gaps()).toEqual([5_000, 10_000]);

  // A cycle that changed something restarts the sequence too.
  changed = true;
  await vi.advanceTimersByTimeAsync(20_000);
  changed = false;
  starts.length = 0;
  await vi.advanceTimersByTimeAsync(5_000 + 5_000 + 10_000);
  expect(gaps()).toEqual([5_000, 10_000]);
  await loop.stop();
});

it("keeps the fixed interval on a lapsed deadline without an idle backoff", async () => {
  vi.useFakeTimers();
  const cycle = vi.fn(async () => {});
  const loop = new ConversationChangeLoop({
    runCycle: cycle,
    onFailure: vi.fn(),
    intervalMs: 5_000,
    subscribe: () => () => {},
    nextWakeupAt: () => 0,
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(50_000);
  expect(cycle).toHaveBeenCalledTimes(11);
  await loop.stop();
});

it("rejects an invalid idle backoff", () => {
  for (const idleBackoff of [
    { baseMs: 50, ceilingMs: 1_000 },
    { baseMs: 5_000, ceilingMs: 1_000 },
    { baseMs: 5_000, ceilingMs: 3_600_001 },
  ])
    expect(
      () =>
        new ConversationChangeLoop({
          runCycle: async () => {},
          onFailure: vi.fn(),
          intervalMs: 5_000,
          idleBackoff: { ...idleBackoff, unchanged: () => true },
        }),
    ).toThrow("idle backoff is invalid");
});
