import { afterEach, expect, it, vi } from "vitest";

import { abandonProviderCallOnUpgrade, upgradeWaiting } from "../src/upgrade-preemption.js";

/** ADR-0587: a provider call notices a waiting upgrade within one second. */
const UPGRADE_PREEMPTION_POLL_MILLISECONDS = 1_000;

afterEach(() => {
  vi.useRealTimers();
});

it("aborts a provider call within one poll once an upgrade waits (ADR-0587)", async () => {
  vi.useFakeTimers();
  let waiting = false;
  const reasons: unknown[] = [];
  const stop = abandonProviderCallOnUpgrade({ yieldToUpgrade: async () => waiting }, (reason) =>
    reasons.push(reason),
  );
  await vi.advanceTimersByTimeAsync(UPGRADE_PREEMPTION_POLL_MILLISECONDS * 3);
  expect(reasons).toEqual([]);
  waiting = true;
  await vi.advanceTimersByTimeAsync(UPGRADE_PREEMPTION_POLL_MILLISECONDS);
  expect(reasons).toHaveLength(1);
  expect(reasons[0]).toMatchObject({ code: "knowledge_capacity_unavailable" });
  await stop();
});

it.each([false, true])(
  "lets no abort land after stop from a check in flight that answers %s (ADR-0587)",
  async (answer) => {
    vi.useFakeTimers();
    // The admission database answers slowly, as under lock contention. An answer of true means an
    // upgrade started waiting after the caller's fence: the call has already returned its answer.
    let checks = 0;
    const reasons: unknown[] = [];
    const stop = abandonProviderCallOnUpgrade(
      {
        yieldToUpgrade: () =>
          new Promise((resolveCheck) => {
            checks += 1;
            setTimeout(() => resolveCheck(answer), 500);
          }),
      },
      (reason) => reasons.push(reason),
    );
    await vi.advanceTimersByTimeAsync(UPGRADE_PREEMPTION_POLL_MILLISECONDS + 100);
    expect(checks).toBe(1);
    const stopped = stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopped;
    await vi.advanceTimersByTimeAsync(UPGRADE_PREEMPTION_POLL_MILLISECONDS * 5);
    expect(checks).toBe(1);
    expect(reasons).toEqual([]);
  },
);

it("treats an unreadable answer or a one-shot caller as no upgrade waiting (ADR-0587)", async () => {
  expect(await upgradeWaiting({})).toBe(false);
  expect(await upgradeWaiting({ yieldToUpgrade: () => Promise.reject(new Error("locked")) })).toBe(
    false,
  );
  expect(await upgradeWaiting({ yieldToUpgrade: async () => true })).toBe(true);
  vi.useFakeTimers();
  const reasons: unknown[] = [];
  const stop = abandonProviderCallOnUpgrade({}, (reason) => reasons.push(reason));
  await vi.advanceTimersByTimeAsync(UPGRADE_PREEMPTION_POLL_MILLISECONDS * 3);
  await stop();
  expect(reasons).toEqual([]);
});
