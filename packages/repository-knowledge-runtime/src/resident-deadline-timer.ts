/** setTimeout fires at once for a delay above this (about 24.8 days). */
const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

/**
 * ADR-0602: one timer for the earliest of several named deadlines. Setting or clearing a
 * deadline re-arms it, and when it fires it hands every due name to `fire` once, then arms for
 * the next one. With no deadline it arms nothing. A deadline set again, still in the past, to a
 * moment no later than the one it just fired at is refused and reported through `onRefused`:
 * re-firing it would spin, because nothing it waited for can have changed.
 */
export class ResidentDeadlineTimer<Name extends string> {
  private readonly deadlines = new Map<Name, number>();
  private readonly fired = new Map<Name, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly fire: (due: Name[]) => void,
    private readonly now: () => number = Date.now,
    private readonly onRefused?: (name: Name, at: number) => void,
  ) {}

  set(name: Name, at: number | null): void {
    if (at === null || !Number.isFinite(at)) this.deadlines.delete(name);
    else if (at <= (this.fired.get(name) ?? Number.NEGATIVE_INFINITY) && at <= this.now()) {
      this.deadlines.delete(name);
      this.onRefused?.(name, at);
    } else this.deadlines.set(name, at);
    this.arm();
  }

  get(name: Name): number | null {
    return this.deadlines.get(name) ?? null;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || this.deadlines.size === 0) return;
    const next = Math.min(...this.deadlines.values());
    const delay = Math.min(MAXIMUM_TIMER_DELAY_MILLISECONDS, Math.max(0, next - this.now()));
    this.timer = setTimeout(() => this.expire(), delay);
  }

  private expire(): void {
    this.timer = null;
    const now = this.now();
    const due = [...this.deadlines].filter(([, at]) => at <= now).map(([name]) => name);
    for (const name of due) {
      this.fired.set(name, this.deadlines.get(name)!);
      this.deadlines.delete(name);
    }
    if (due.length > 0) this.fire(due);
    this.arm();
  }
}
