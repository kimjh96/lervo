export interface ConversationRepositorySignalSchedule {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const systemSchedule: ConversationRepositorySignalSchedule = {
  schedule: (delayMs, callback) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ConversationRepositorySignalLoop {
  private handle: unknown;
  private stopped = true;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly options: {
      runCycle(): Promise<unknown>;
      onFailure(): void;
      intervalMs: number;
      schedule?: ConversationRepositorySignalSchedule;
    },
  ) {
    if (
      !Number.isSafeInteger(options.intervalMs) ||
      options.intervalMs < 100 ||
      options.intervalMs > 60_000
    ) {
      throw new Error("The conversation repository signal interval is invalid.");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.handle !== undefined) {
      (this.options.schedule ?? systemSchedule).cancel(this.handle);
      this.handle = undefined;
    }
    return this.inFlight ?? Promise.resolve();
  }

  private schedule(delayMs: number): void {
    this.handle = (this.options.schedule ?? systemSchedule).schedule(delayMs, () => {
      this.handle = undefined;
      const operation = this.run();
      this.inFlight = operation;
      void operation.finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
      });
    });
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
