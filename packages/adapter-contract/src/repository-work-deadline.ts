const MAXIMUM_TURN_DURATION_MS = 90 * 60_000;
const MAXIMUM_INACTIVITY_MULTIPLIER = 3;

export function repositoryWorkMaximumDurationMs(inactivityTimeoutMs: number): number {
  if (!Number.isFinite(inactivityTimeoutMs) || inactivityTimeoutMs <= 0) {
    throw new Error("The repository-work inactivity timeout must be positive and finite.");
  }
  return Math.min(
    MAXIMUM_TURN_DURATION_MS,
    Math.max(inactivityTimeoutMs, inactivityTimeoutMs * MAXIMUM_INACTIVITY_MULTIPLIER),
  );
}

/** A provider can remain active past its inactivity window, but never past its absolute bound. */
export class RepositoryWorkProgressDeadline {
  private inactivityTimer: ReturnType<typeof setTimeout>;
  private readonly maximumTimer: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly inactivityTimeoutMs: number,
    private readonly onTimeout: () => void,
  ) {
    const maximumDurationMs = repositoryWorkMaximumDurationMs(inactivityTimeoutMs);
    this.inactivityTimer = this.scheduleInactivity();
    this.maximumTimer = setTimeout(() => this.expire(), maximumDurationMs);
    this.maximumTimer.unref?.();
  }

  observeProgress(): void {
    if (this.stopped) return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = this.scheduleInactivity();
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.inactivityTimer);
    clearTimeout(this.maximumTimer);
  }

  private scheduleInactivity(): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.expire(), this.inactivityTimeoutMs);
    timer.unref?.();
    return timer;
  }

  private expire(): void {
    if (this.stopped) return;
    this.close();
    this.onTimeout();
  }
}
