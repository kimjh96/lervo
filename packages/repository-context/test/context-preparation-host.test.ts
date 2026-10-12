import { describe, expect, it, vi, afterEach } from "vitest";
import { ContextPreparationHost } from "../src/context-preparation-host.js";
const signal = () => new AbortController().signal;
const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const input = (key: string) => ({
  key,
  reservedBytes: 10,
  deadlineMs: 1000,
  maximumProviderCalls: 0,
  signal: signal(),
});
afterEach(() => vi.useRealTimers());
describe("context preparation host", () => {
  it("shares work, clones results per waiter and cancels only the detached consumer", async () => {
    const host = new ContextPreparationHost();
    const work = deferred();
    const controller = new AbortController();
    let underlying: AbortSignal | undefined;
    const fn = vi.fn(async (budget) => {
      underlying = budget.signal;
      return work.promise;
    });
    const first = host.run({ ...input("same"), signal: controller.signal, work: fn });
    const second = host.run({ ...input("same"), work: fn });
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "context_cancelled" });
    expect(underlying!.aborted).toBe(false);
    work.resolve("complete");
    expect(await second).toBe("complete");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("counts queue time, rejects overflow and retains slots until cancelled work really stops", async () => {
    vi.useFakeTimers();
    const host = new ContextPreparationHost({
      maximumConcurrent: 1,
      maximumPending: 1,
      maximumRetainedBytes: 30,
    });
    const work = deferred();
    const first = host.run({ ...input("a"), work: () => work.promise });
    const secondWork = vi.fn(async () => "b");
    const second = host.run({ ...input("b"), deadlineMs: 10, work: secondWork });
    const secondRejected = expect(second).rejects.toMatchObject({
      code: "context_budget_exceeded",
    });
    await expect(host.run({ ...input("c"), work: async () => "c" })).rejects.toMatchObject({
      code: "context_budget_exceeded",
    });
    await vi.advanceTimersByTimeAsync(10);
    await secondRejected;
    expect(secondWork).not.toHaveBeenCalled();
    work.resolve("a");
    expect(await first).toBe("a");
  });
  it("enforces aggregate bytes and provider budgets, and evicts completed work", async () => {
    const host = new ContextPreparationHost({
      maximumConcurrent: 2,
      maximumPending: 2,
      maximumRetainedBytes: 15,
    });
    const work = deferred();
    const first = host.run({ ...input("a"), work: () => work.promise });
    await expect(host.run({ ...input("b"), work: async () => "b" })).rejects.toMatchObject({
      code: "context_budget_exceeded",
    });
    work.resolve("done");
    await first;
    await Promise.resolve();
    await expect(
      host.run({
        ...input("a"),
        work: async ({ chargeProviderCall }) => {
          chargeProviderCall();
          return "bad";
        },
      }),
    ).rejects.toMatchObject({ code: "context_budget_exceeded" });
  });
  it("aborts the underlying work when its last waiter leaves and never promotes late completion", async () => {
    const host = new ContextPreparationHost();
    const controller = new AbortController();
    const work = deferred();
    let underlying: AbortSignal | undefined;
    const first = host.run({
      ...input("a"),
      signal: controller.signal,
      work: async ({ signal }) => {
        underlying = signal;
        return work.promise;
      },
    });
    await Promise.resolve();
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "context_cancelled" });
    expect(underlying!.aborted).toBe(true);
    work.resolve("stale");
    expect(await host.run({ ...input("a"), work: async () => "fresh" })).toBe("fresh");
  });
});

it("rejects non-detachable results for every waiter and releases the job", async () => {
  const host = new ContextPreparationHost();
  const first = host.run({ ...input("bad"), work: async () => ({ callback: () => undefined }) });
  const second = host.run({ ...input("bad"), work: async () => ({ callback: () => undefined }) });
  await expect(first).rejects.toMatchObject({ code: "context_contract_invalid" });
  await expect(second).rejects.toMatchObject({ code: "context_contract_invalid" });
  expect(await host.run({ ...input("bad"), work: async () => "fresh" })).toBe("fresh");
});
