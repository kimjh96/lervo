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

  it("resumes using only a verified cursor and falls back after an invalid peer response", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply)
      .mockResolvedValueOnce({
        ...reply,
        authentication: { ...reply.authentication, peerIdentityHash: `sha256:${"2".repeat(64)}` },
      });
    const wait = new RuntimeIdleWait({
      ...options(),
      transport: () => ({ waitForRuntimeChange: request }),
    });
    const signal = new AbortController().signal;
    await wait.wait(signal);
    const second = wait.wait(signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await second;
    expect(request.mock.calls[1]![0].cursor).toBe(cursor);
    const fallback = wait.wait(signal);
    await vi.advanceTimersByTimeAsync(2_000);
    await fallback;
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
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
});
