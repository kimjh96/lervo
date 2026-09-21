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
