export interface ConversationChangeSchedule {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

const systemSchedule: ConversationChangeSchedule = {
  schedule: (delayMs, callback) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ConversationChangeLoopOptions<TResult = unknown> {
  runCycle(): Promise<TResult>;
  onFailure(error: unknown): void;
  intervalMs: number;
  continueOnFailure?: boolean;
  /**
   * The base retry delay after `error`, doubled per consecutive failure up to
   * `failureRetryCeilingMs`; null when the failure is a settled state that only a change ends.
   */
  failureRetryMs?(error: unknown): number | null;
  failureRetryCeilingMs?: number;
  schedule?: ConversationChangeSchedule;
  subscribe?(notify: () => void): () => void;
  nextWakeupAt?(): number | null;
}

/**
 * Serial change-driven work. ADR-0602: it runs on a change notification or at the next deadline,
 * never on an interval. A deadline that has already passed when a cycle ends gets one more cycle;
 * if it is still the same lapsed deadline after that, the loop waits for a change or a new
 * deadline instead of polling it. `intervalMs` is the delay of that one cycle and the base retry
 * after a failure without its own; consecutive failures back off exponentially to a ceiling, and
 * every failure reaches `onFailure`, which reports it, until a cycle succeeds.
 */
export const CHANGE_LOOP_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

export class ConversationChangeLoop<TResult = unknown> {
  private handle: unknown;
  private stopped = true;
  private inFlight: Promise<void> | null = null;
  private unsubscribe: (() => void) | undefined;
  private pending = false;
  /** The lapsed deadline that already got its one extra cycle. */
  private lapsedHandled: number | null = null;
  private failures = 0;
  private deadlineFailures = 0;

  constructor(private readonly options: ConversationChangeLoopOptions<TResult>) {
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
    let result: TResult | undefined;
    try {
      result = await this.options.runCycle();
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
    if (failed) {
      this.failures = Math.min(this.failures + 1, 64);
      const chosen = this.options.failureRetryMs
        ? this.options.failureRetryMs(failure)
        : this.options.intervalMs;
      // A settled failure, such as an inactive workstream, waits for the change that ends it.
      if (chosen === null) return;
      const base =
        Number.isSafeInteger(chosen) && chosen >= 100 && chosen <= 300_000
          ? chosen
          : this.options.intervalMs;
      const ceiling = Math.max(
        base,
        this.options.failureRetryCeilingMs ?? CHANGE_LOOP_RETRY_CEILING_MILLISECONDS,
      );
      this.schedule(Math.min(ceiling, base * 2 ** Math.min(this.failures - 1, 30)));
      return;
    }
    this.failures = 0;
    let deadline: number | null;
    try {
      deadline = this.options.nextWakeupAt?.() ?? null;
      this.deadlineFailures = 0;
    } catch (error) {
      // An unreadable deadline is a failure of its own: reported, and retried with its own
      // backoff, since the cycle before it succeeded and reset the cycle's.
      this.options.onFailure(error);
      this.deadlineFailures = Math.min(this.deadlineFailures + 1, 64);
      this.schedule(
        Math.min(
          Math.max(
            this.options.intervalMs,
            this.options.failureRetryCeilingMs ?? CHANGE_LOOP_RETRY_CEILING_MILLISECONDS,
          ),
          this.options.intervalMs * 2 ** Math.min(this.deadlineFailures - 1, 30),
        ),
      );
      return;
    }
    if (deadline === null || !Number.isFinite(deadline)) return;
    if (deadline > Date.now()) {
      this.lapsedHandled = null;
      this.schedule(Math.min(deadline - Date.now(), 2_147_483_647));
      return;
    }
    // A lapsed deadline gets one more cycle; the same lapsed deadline again waits for a change.
    if (this.lapsedHandled === deadline) return;
    this.lapsedHandled = deadline;
    void result;
    this.schedule(this.options.intervalMs);
  }
}
