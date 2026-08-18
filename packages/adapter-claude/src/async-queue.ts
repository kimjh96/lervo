export class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters = new Set<() => void>();
  private ended = false;
  private failure: Error | undefined;

  push(value: T): void {
    if (this.ended) return;
    this.values.push(value);
    this.wake();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.wake();
  }

  fail(error: Error): void {
    if (this.ended) return;
    this.failure = error;
    this.ended = true;
    this.wake();
  }

  async *iterate(signal: AbortSignal): AsyncIterable<T> {
    while (!signal.aborted) {
      if (this.values.length > 0) {
        yield this.values.shift() as T;
        continue;
      }
      if (this.failure !== undefined) throw this.failure;
      if (this.ended) return;
      await this.wait(signal);
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.ended || this.values.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        this.waiters.delete(finish);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      this.waiters.add(finish);
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}
