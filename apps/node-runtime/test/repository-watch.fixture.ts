import { performance } from "node:perf_hooks";
import { expect, vi, type Mock } from "vitest";

/** Drain delayed native notifications before measuring the next independent operation. */
export async function settleRepositoryWatch(notify: Mock<() => void>): Promise<void> {
  let count = notify.mock.calls.length;
  let unchangedSince = performance.now();
  await vi.waitFor(
    () => {
      if (notify.mock.calls.length !== count) {
        count = notify.mock.calls.length;
        unchangedSince = performance.now();
      }
      expect(performance.now() - unchangedSince).toBeGreaterThanOrEqual(500);
    },
    { timeout: 10_000, interval: 50 },
  );
}
