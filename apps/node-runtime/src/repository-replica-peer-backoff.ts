/**
 * ADR-0570: one admission gate for the whole peer transport. Every configured replica shares the
 * peer host, so a cycle that cannot reach it closes the gate for all of them: while closed, no
 * reconciliation or subscription contacts the peer. At the retry time exactly one probe runs.
 * Success reopens the gate; failure doubles the wait up to the ceiling. A stopped or restarting
 * peer therefore sees one connection attempt per back-off period instead of one per replica and
 * cycle.
 */
export class ReplicaPeerBackoff {
  private failures = 0;
  private retryAtMs: number | null = null;
  private probing = false;
  private readonly ceilingMs: number;

  constructor(
    private readonly baseMs: number,
    ceilingMs: number,
  ) {
    if (!Number.isSafeInteger(baseMs) || baseMs < 1 || !Number.isSafeInteger(ceilingMs))
      throw new Error("The replica peer back-off configuration is invalid.");
    this.ceilingMs = Math.max(baseMs, ceilingMs);
  }

  get closed(): boolean {
    return this.retryAtMs !== null;
  }

  /** When the next probe may run; null while the gate is open. */
  get retryAt(): number | null {
    return this.retryAtMs;
  }

  get consecutiveFailures(): number {
    return this.failures;
  }

  /**
   * Records an unreachable peer. Cycles that were already running when the gate closed fail for
   * the same outage, so only the first failure or a failed probe lengthens the wait.
   */
  observeUnreachable(now: number): void {
    if (this.closed && !this.probing) return;
    this.failures += 1;
    this.probing = false;
    this.retryAtMs = now + Math.min(this.ceilingMs, this.baseMs * 2 ** (this.failures - 1));
  }

  /** Records any answer from the peer; returns true when that reopened a closed gate. */
  observeReachable(): boolean {
    const reopened = this.closed;
    this.failures = 0;
    this.retryAtMs = null;
    this.probing = false;
    return reopened;
  }

  /** Claims the single probe when the gate is closed and its retry time has come. */
  beginProbe(now: number): boolean {
    if (this.retryAtMs === null || this.probing || now < this.retryAtMs) return false;
    this.probing = true;
    return true;
  }
}
