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
  /**
   * The next deadline, or every deadline the loop's duties have. A lapsed one is reported as it is,
   * never dropped: it gets its one extra cycle, and it never hides a later deadline.
   */
  nextWakeupAt?(): number | readonly (number | null)[] | null;
  /**
   * ADR-0602: called with the reason when the loop has no change signal (no `subscribe`, or one
   * that threw), and with null when it stops. Without it, the reason is written to stderr once.
   */
  onChangeSignal?(failure: unknown): void;
}

/**
 * Serial change-driven work. ADR-0602: it runs on a change notification or at the next deadline,
 * never on an interval. A deadline that has already passed when a cycle ends gets one more cycle;
 * if it is still the same lapsed deadline after that, the loop waits for a change or a new
 * deadline instead of polling it. A lapsed deadline never hides a later one: the earliest future
 * deadline always arms the timer. `intervalMs` is the delay of that one cycle and the base retry
 * after a failure without its own; consecutive failures back off exponentially to a ceiling, and
 * every failure reaches `onFailure`, which reports it, until a cycle succeeds. A loop with no change
 * signal never goes silent: it runs again at least every minute, and reports that it has none
 * through `onChangeSignal`.
 */
export const CHANGE_LOOP_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/**
 * ADR-0602: how often a loop without a working change signal looks again. Its attention is already
 * raised, so a faster look would only spend CPU.
 */
export const CHANGE_LOOP_UNWATCHED_MILLISECONDS = 60_000;

export class ConversationChangeLoop<TResult = unknown> {
  private handle: unknown;
  private stopped = true;
  private inFlight: Promise<void> | null = null;
  private unsubscribe: (() => void) | undefined;
  private pending = false;
  /** The lapsed deadlines, still reported, that already got their one extra cycle. */
  private lapsedHandled = new Set<number>();
  private failures = 0;
  private deadlineFailures = 0;
  /** Whether a change notification can wake the loop; without one it keeps its interval. */
  private watched = false;

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
    let failure: unknown = null;
    try {
      this.unsubscribe = this.options.subscribe?.(() => this.notify());
    } catch (error) {
      this.unsubscribe = undefined;
      failure = error;
    }
    this.watched = this.unsubscribe !== undefined;
    if (!this.watched) this.reportUnwatched(failure);
    this.cancel();
    this.schedule(0);
  }

  stop(): Promise<void> {
    const reported = !this.stopped && !this.watched;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (reported) this.options.onChangeSignal?.(null);
    this.cancel();
    return this.inFlight ?? Promise.resolve();
  }

  private reportUnwatched(cause: unknown): void {
    const failure = Object.assign(
      new Error(
        cause === null
          ? "This loop has no change signal, so it runs on its interval."
          : `This loop's change signal could not be armed (${cause instanceof Error ? cause.message : String(cause)}), so it runs on its interval.`,
        { cause },
      ),
      { code: "conversation_change_signal_unavailable" },
    );
    if (this.options.onChangeSignal !== undefined) this.options.onChangeSignal(failure);
    else process.stderr.write(`Lervo change loop: ${failure.message}\n`);
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
    let reported: number | readonly (number | null)[] | null;
    try {
      reported = this.options.nextWakeupAt?.() ?? null;
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
    void result;
    const now = Date.now();
    const deadlines = (Array.isArray(reported) ? reported : [reported]).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    const lapsed = deadlines.filter((deadline) => deadline <= now);
    const future = deadlines.filter((deadline) => deadline > now);
    // A lapsed deadline gets one more cycle; the same one again does not, so it never spins. The
    // set holds only what is still reported, so it stays bounded by the duties.
    const fresh = lapsed.some((deadline) => !this.lapsedHandled.has(deadline));
    this.lapsedHandled = new Set(lapsed);
    const next = future.length === 0 ? null : Math.min(...future) - now;
    // Without a change signal, nothing else would wake the loop: it looks again within a minute.
    if (!this.watched) {
      const unwatched = Math.max(this.options.intervalMs, CHANGE_LOOP_UNWATCHED_MILLISECONDS);
      this.schedule(fresh ? this.options.intervalMs : Math.min(next ?? Infinity, unwatched));
      return;
    }
    if (fresh) {
      this.schedule(this.options.intervalMs);
      return;
    }
    if (next !== null) this.schedule(Math.min(next, 2_147_483_647));
  }
}
