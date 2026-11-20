import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeIdleWait } from "../src/runtime-idle-wait.js";

const identity = `sha256:${"1".repeat(64)}`;
const cursor = "12345678-1234-1234-1234-123456789abc";
const reply = {
  authentication: { status: "verified", destinationId: "hub:one", peerIdentityHash: identity },
  body: { schemaVersion: 1, status: "changed", cursor },
};
function options() {
  return {
    topic: "workstream" as const,
    destinationId: "hub:one",
    expectedPeerIdentityHash: identity,
    fallbackIntervalMs: 2_000,
  };
}
afterEach(() => vi.useRealTimers());

describe("runtime idle scheduling", () => {
  it("coalesces pre-wait hints and cancels an in-flight remote wait on local change", async () => {
    const request = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        ),
    );
    const wait = new RuntimeIdleWait({
      ...options(),
      transport: () => ({ waitForRuntimeChange: request }),
    });
    wait.notify();
    wait.notify();
    await wait.wait(new AbortController().signal);
    expect(request).not.toHaveBeenCalled();
    const pending = wait.wait(new AbortController().signal);
    expect(request).toHaveBeenCalledTimes(1);
    wait.notify();
    await pending;
    expect(request.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it("holds with no timer, resumes with a verified cursor, and backs failures off (ADR-0602)", async () => {
    vi.useFakeTimers();
    const failures: unknown[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply)
      .mockResolvedValueOnce({
        ...reply,
        authentication: { ...reply.authentication, peerIdentityHash: `sha256:${"2".repeat(64)}` },
      })
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(reply);
    const wait = new RuntimeIdleWait({
      ...options(),
      transport: () => ({ waitForRuntimeChange: request }),
      onAvailability: (failure) => failures.push(failure),
    });
    const signal = new AbortController().signal;
    await wait.wait(signal);
    expect(vi.getTimerCount()).toBe(0);
    // An invalid peer answer: the cursor is dropped and the retry waits the base interval.
    const second = wait.wait(signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls[1]![0].cursor).toBe(cursor);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await second;
    // A transport failure doubles the wait.
    const third = wait.wait(signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls[2]![0].cursor).toBeNull();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await third;
    await wait.wait(signal);
    expect(request).toHaveBeenCalledTimes(4);
    // The first failure is routine; the second in a row is reported, and the answer clears it.
    expect(failures).toHaveLength(2);
    expect(failures.at(-1)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for local changes only without a hint transport, and reports it once", async () => {
    vi.useFakeTimers();
    const failures: unknown[] = [];
    const wait = new RuntimeIdleWait({
      ...options(),
      transport: () => null,
      onAvailability: (failure) => failures.push(failure),
    });
    const pending = wait.wait(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(vi.getTimerCount()).toBe(0);
    wait.notify();
    await pending;
    const again = wait.wait(new AbortController().signal);
    wait.notify();
    await again;
    expect(failures).toHaveLength(1);
  });

  it("aborts a fallback timer promptly and leaves no timers", async () => {
    vi.useFakeTimers();
    const wait = new RuntimeIdleWait({ ...options(), transport: () => null });
    const abort = new AbortController();
    const pending = wait.wait(abort.signal);
    abort.abort();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits again on a bound answer without returning, and uses the legacy hold on an old Hub (ADR-0602)", async () => {
    const timeout = { ...reply, body: { schemaVersion: 1, status: "timeout", cursor } };
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply)
      // The Hub's ten-minute bound passed with no change: held again here.
      .mockResolvedValueOnce(timeout)
      .mockResolvedValueOnce(timeout)
      .mockRejectedValueOnce(Object.assign(new Error("invalid_request"), { status: 400 }))
      .mockResolvedValueOnce({
        ...reply,
        body: {
          schemaVersion: 1,
          status: "changed",
          cursor: "22345678-1234-1234-1234-123456789abc",
        },
      });
    const wait = new RuntimeIdleWait({
      ...options(),
      transport: () => ({ waitForRuntimeChange: request }),
    });
    const signal = new AbortController().signal;
    await wait.wait(signal);
    await wait.wait(signal);
    expect(request).toHaveBeenCalledTimes(5);
    // An old Hub refused the open hold; its bounded legacy hold is asked for instead.
    expect(request.mock.calls[3]![0]).not.toHaveProperty("legacy");
    expect(request.mock.calls[4]![0]).toMatchObject({ legacy: true });
  });
});
