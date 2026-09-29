const RENEWAL_INTERVAL_MS = 10 * 60_000;

/** Keeps the exact claim alive while one bounded convergence stage runs. */
export function maintainConvergenceAssignmentLease(input: {
  assertStageLease(): void;
  renew(): Promise<unknown>;
}): { assertHealthy(): void; stop(): Promise<void> } {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let failure: unknown = null;
  const timer = setInterval(() => {
    if (stopped || inFlight !== null || failure !== null) return;
    inFlight = Promise.resolve()
      .then(() => {
        input.assertStageLease();
        return input.renew();
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        failure = error;
      })
      .finally(() => {
        inFlight = null;
      });
  }, RENEWAL_INTERVAL_MS);
  timer.unref();
  return {
    assertHealthy() {
      if (failure !== null) throw failure;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
