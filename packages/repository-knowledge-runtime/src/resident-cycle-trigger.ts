/**
 * ADR-0461 and ADR-0602: starts the resident's cycles one at a time. A change wakes it after the
 * debounce (quiet for `debounce`, at most twice that after the first change); an urgent wake, such
 * as a Hub change or a released lease, starts it at once. A wake that arrives while a cycle runs
 * starts exactly one more cycle after it, urgent first. No wake, no timer.
 */
export function residentCycleTrigger(input: {
  signal: AbortSignal;
  debounceMilliseconds: number;
  /** One cycle, including setting its own next deadline. */
  run: () => Promise<void>;
  /** Every wake, debounced or urgent, before the cycle it leads to. */
  onWake: () => void;
}): {
  /** Starts a cycle now, or after the running one. */
  cycle(): void;
  /** A debounced wake. */
  schedule(): void;
  /** An urgent wake. */
  wakeNow(): void;
  /** Runs one more cycle after the running one, without a wake of its own. */
  again(): void;
  running(): Promise<void> | null;
  stop(): void;
} {
  let running: Promise<void> | null = null;
  let pending = false;
  let urgent = false;
  let firstWake: number | null = null;
  let lastWake: number | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const clearDebounce = () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
    firstWake = null;
    lastWake = null;
  };
  const cycle = () => {
    if (input.signal.aborted) return;
    if (running !== null) {
      pending = true;
      return;
    }
    running = input.run().finally(() => {
      running = null;
      if (input.signal.aborted) return;
      if (urgent) {
        urgent = false;
        pending = false;
        cycle();
      } else if (pending) {
        pending = false;
        schedule();
      }
    });
  };
  const schedule = () => {
    const now = Date.now();
    input.onWake();
    firstWake ??= now;
    lastWake = now;
    if (debounce !== null) clearTimeout(debounce);
    const quiet = input.debounceMilliseconds;
    const delay = Math.max(0, Math.min(lastWake + quiet, firstWake + 2 * quiet) - now);
    debounce = setTimeout(() => {
      clearDebounce();
      cycle();
    }, delay);
  };
  return {
    cycle,
    schedule,
    wakeNow: () => {
      if (input.signal.aborted) return;
      input.onWake();
      if (running !== null) {
        urgent = true;
        return;
      }
      clearDebounce();
      cycle();
    },
    again: () => {
      if (running !== null) pending = true;
    },
    running: () => running,
    stop: clearDebounce,
  };
}
