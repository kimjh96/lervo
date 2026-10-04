import { afterEach, describe, expect, it, vi } from "vitest";

import { maintainConvergenceAssignmentLease } from "../src/convergence-assignment-lease.js";

afterEach(() => vi.useRealTimers());

describe("convergence assignment lease renewal", () => {
  it("renews a running stage and stops before assignment settlement", async () => {
    vi.useFakeTimers();
    const assertStageLease = vi.fn();
    const renew = vi.fn(async () => undefined);
    const lease = maintainConvergenceAssignmentLease({ assertStageLease, renew });

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(assertStageLease).toHaveBeenCalledTimes(2);
    lease.assertHealthy();

    await lease.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("retains a failed exact renewal for the stage authority check", async () => {
    vi.useFakeTimers();
    const failure = new Error("lease changed");
    const lease = maintainConvergenceAssignmentLease({
      assertStageLease: vi.fn(),
      renew: vi.fn(async () => {
        throw failure;
      }),
    });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(() => lease.assertHealthy()).toThrow(failure);
    await lease.stop();
  });
});
