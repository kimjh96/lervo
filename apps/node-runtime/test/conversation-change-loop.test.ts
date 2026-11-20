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

it("gives a lapsed deadline one more cycle, then waits for a change or a new deadline (ADR-0602)", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  let deadline = 0;
  const cycle = vi.fn(async () => {});
  const loop = new ConversationChangeLoop({
    runCycle: cycle,
    onFailure: vi.fn(),
    intervalMs: 5_000,
    continueOnFailure: true,
    subscribe: (callback) => {
      notify = callback;
      return () => {};
    },
    nextWakeupAt: () => deadline,
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(0);
  // The start cycle, then one more for the lapsed deadline, then nothing however long it waits.
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  expect(cycle).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  // A hint runs at once; the same lapsed deadline gets no further cycle.
  notify();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cycle).toHaveBeenCalledTimes(3);
  // A new lapsed deadline gets its one cycle after the next hint.
  deadline = 1;
  notify();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(cycle).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
  await loop.stop();
});

it("backs repeated failures off exponentially, resets on success, and waits for a change on a settled failure (ADR-0602)", async () => {
  vi.useFakeTimers();
  let notify = () => {};
  let fail: "retry" | "settled" | null = "retry";
  const at: number[] = [];
  const begin = Date.now();
  const loop = new ConversationChangeLoop({
    runCycle: async () => {
      at.push((Date.now() - begin) / 1_000);
      if (fail !== null) throw Object.assign(new Error("failed"), { code: fail });
    },
    onFailure: vi.fn(),
    intervalMs: 1_000,
    continueOnFailure: true,
    failureRetryMs: (error) => ((error as { code: string }).code === "settled" ? null : 1_000),
    failureRetryCeilingMs: 8_000,
    subscribe: (callback) => {
      notify = callback;
      return () => undefined;
    },
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(30_000);
  // 1, 2, 4, then the 8-second ceiling.
  expect(at).toEqual([0, 1, 3, 7, 15, 23]);
  fail = null;
  await vi.advanceTimersByTimeAsync(8_000);
  expect(at.at(-1)).toBe(31);
  expect(vi.getTimerCount()).toBe(0);
  fail = "settled";
  notify();
  await vi.advanceTimersByTimeAsync(0);
  const settled = at.length;
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  expect(at).toHaveLength(settled);
  expect(vi.getTimerCount()).toBe(0);
  fail = null;
  notify();
  await vi.advanceTimersByTimeAsync(0);
  expect(at).toHaveLength(settled + 1);
  await loop.stop();
});

it("backs an unreadable deadline off even though each cycle succeeds, and reports it (ADR-0602)", async () => {
  vi.useFakeTimers();
  const at: number[] = [];
  const begin = Date.now();
  const onFailure = vi.fn();
  const loop = new ConversationChangeLoop({
    runCycle: async () => {
      at.push((Date.now() - begin) / 1_000);
    },
    onFailure,
    intervalMs: 1_000,
    continueOnFailure: true,
    failureRetryCeilingMs: 8_000,
    nextWakeupAt: () => {
      throw new Error("deadline unreadable");
    },
  });
  loop.start();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(at).toEqual([0, 1, 3, 7, 15, 23]);
  expect(onFailure).toHaveBeenCalledTimes(at.length);
  await loop.stop();
});
