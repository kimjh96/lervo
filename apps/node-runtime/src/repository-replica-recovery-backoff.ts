/** What one reconciliation proved: `current` means both sides were already equal. */
export type ReplicaReconcileOutcome = "current" | "not_current";

/**
 * Interval of the idle recovery sweep. Each due sweep doubles it up to the ceiling while every
 * configured replica's latest outcome is `current`; a change hint or any other outcome returns it
 * to the base interval.
 */
export class ReplicaRecoveryBackoff {
  private intervalMs: number;
  private readonly ceilingMs: number;
  private readonly outcomes = new Map<string, ReplicaReconcileOutcome>();

  constructor(
    private readonly replicaIds: readonly string[],
    private readonly baseMs: number,
    ceilingMs: number,
  ) {
    if (!Number.isSafeInteger(baseMs) || baseMs < 1 || !Number.isSafeInteger(ceilingMs))
      throw new Error("The replica recovery back-off configuration is invalid.");
    this.intervalMs = baseMs;
    this.ceilingMs = Math.max(baseMs, ceilingMs);
  }

  get recoveryIntervalMs(): number {
    return this.intervalMs;
  }

  /** Returns the delay until the sweep after the one now due. */
  sweep(): number {
    if (this.replicaIds.every((replicaId) => this.outcomes.get(replicaId) === "current"))
      this.intervalMs = Math.min(this.ceilingMs, this.intervalMs * 2);
    return this.intervalMs;
  }

  /** Returns true when the interval was reset to its base. */
  observe(replicaId: string, outcome: ReplicaReconcileOutcome): boolean {
    this.outcomes.set(replicaId, outcome);
    return outcome === "current" ? false : this.reset();
  }

  reset(): boolean {
    const changed = this.intervalMs !== this.baseMs;
    this.intervalMs = this.baseMs;
    return changed;
  }
}
