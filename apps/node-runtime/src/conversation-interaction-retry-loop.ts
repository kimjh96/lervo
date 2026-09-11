export interface ConversationInteractionRetrySchedule {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const systemSchedule: ConversationInteractionRetrySchedule = {
  schedule(delayMs, callback) {
    return setTimeout(callback, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function reportConversationInteractionRetryFailure(
  error: unknown,
  onError?: (error: Error) => void,
): void {
  const failure = error instanceof Error ? error : new Error("The interaction retry cycle failed.");
  if (onError === undefined) {
    process.stderr.write(`Lervo Discord interaction retry failed: ${failure.message}\n`);
  } else {
    onError(failure);
  }
}

export class ConversationInteractionRetryLoop {
  private handle: unknown;
  private stopped = true;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly options: {
      runCycle(): Promise<void>;
      onFailure(error: unknown): void;
      intervalMs?: number;
      schedule?: ConversationInteractionRetrySchedule;
    },
  ) {
    const intervalMs = options.intervalMs ?? 2_000;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000) {
      throw new Error("The conversation retry interval is invalid.");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  stop(): Promise<void> {
    if (this.stopped && this.inFlight === null) return Promise.resolve();
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
    } catch (error) {
      this.options.onFailure(error);
    }
    if (!this.stopped) this.schedule(this.options.intervalMs ?? 2_000);
  }
}
