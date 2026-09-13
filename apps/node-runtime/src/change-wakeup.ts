/** Loss-tolerant hints: callers always recheck durable state after waking. */
export class ChangeWakeup {
  revision = 0;
  private readonly listeners = new Set<() => void>();

  notify(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) listener();
  }

  wait(after: number, maximumWaitMs: number, signal?: AbortSignal): Promise<void> {
    if (this.revision !== after || signal?.aborted || maximumWaitMs <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(done);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, maximumWaitMs);
      this.listeners.add(done);
      signal?.addEventListener("abort", done, { once: true });
      if (this.revision !== after || signal?.aborted) done();
    });
  }
}
