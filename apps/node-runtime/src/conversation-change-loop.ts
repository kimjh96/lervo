export interface ConversationChangeSchedule {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const systemSchedule: ConversationChangeSchedule = {
  schedule: (delayMs, callback) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ConversationChangeLoopOptions {
  runCycle(): Promise<unknown>;
  onFailure(error: unknown): void;
  intervalMs: number;
  continueOnFailure?: boolean;
  failureRetryMs?(error: unknown): number;
  schedule?: ConversationChangeSchedule;
  subscribe?(notify: () => void): () => void;
  nextWakeupAt?(): number | null;
}

/** Serial change-driven work with deadline timers and bounded missed-hint recovery. */
export class ConversationChangeLoop {
  private handle: unknown;
  private stopped = true;
  private inFlight: Promise<void> | null = null;
  private unsubscribe: (() => void) | undefined;
  private pending = false;

  constructor(private readonly options: ConversationChangeLoopOptions) {
    if (
      !Number.isSafeInteger(options.intervalMs) ||
      options.intervalMs < 100 ||
      options.intervalMs > 60_000
    ) {
      throw new Error("The conversation interval is invalid.");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    try {
      this.unsubscribe = this.options.subscribe?.(() => this.notify());
    } catch {
      this.unsubscribe = undefined;
    }
    this.cancel();
    this.schedule(0);
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.cancel();
    return this.inFlight ?? Promise.resolve();
  }

  private cancel(): void {
    if (this.handle !== undefined) (this.options.schedule ?? systemSchedule).cancel(this.handle);
    this.handle = undefined;
  }

  private notify(): void {
    if (this.stopped) return;
    this.pending = true;
    if (this.inFlight === null) {
      this.cancel();
      this.schedule(0);
    }
  }

  private schedule(delayMs: number): void {
    this.handle = (this.options.schedule ?? systemSchedule).schedule(delayMs, () => {
      this.handle = undefined;
      this.pending = false;
      const operation = this.run();
      this.inFlight = operation;
      const finish = () => {
        if (this.inFlight !== operation) return;
        this.inFlight = null;
        if (!this.stopped && this.pending) {
          this.pending = false;
          this.cancel();
          this.schedule(0);
        }
      };
      void operation.then(finish, finish);
    });
  }

  private async run(): Promise<void> {
    let failed = false;
    let failure: unknown;
    try {
      await this.options.runCycle();
    } catch (error) {
      failed = true;
      failure = error;
      if (!this.options.continueOnFailure) {
        this.stopped = true;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
      this.options.onFailure(error);
    }
    if (this.stopped) return;
    if (this.pending) {
      this.pending = false;
      this.schedule(0);
      return;
    }
    let delay =
      failed && this.options.failureRetryMs !== undefined
        ? this.options.failureRetryMs(failure)
        : this.options.intervalMs;
    if (!Number.isSafeInteger(delay) || delay < 100 || delay > 300_000) {
      delay = this.options.intervalMs;
    }
    if (this.unsubscribe !== undefined && !failed) {
      try {
        const deadline = this.options.nextWakeupAt?.() ?? null;
        if (deadline === null) return;
        delay = deadline <= Date.now() ? this.options.intervalMs : deadline - Date.now();
      } catch {
        delay = this.options.intervalMs;
      }
    }
    this.schedule(delay);
  }
}
