export class ConversationDeliberationLoop {
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly options: {
      runCycle(): Promise<unknown>;
      onFailure(): void;
      intervalMs: number;
    },
  ) {
    if (
      !Number.isSafeInteger(options.intervalMs) ||
      options.intervalMs < 100 ||
      options.intervalMs > 60_000
    ) {
      throw new Error("The conversation deliberation interval is invalid.");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return this.inFlight ?? Promise.resolve();
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const operation = this.run();
      this.inFlight = operation;
      void operation.finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
      });
    }, delayMs);
  }

  private async run(): Promise<void> {
    try {
      await this.options.runCycle();
    } catch {
      this.stopped = true;
      this.options.onFailure();
      return;
    }
    if (!this.stopped) this.schedule(this.options.intervalMs);
  }
}
