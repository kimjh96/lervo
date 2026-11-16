import type { ReplicaReconcileOutcome } from "./repository-replica-recovery-backoff.js";

/** What the gate made of a finished cycle; see `ReplicaPeerBackoff.observeCycle`. */
export interface ReplicaPeerCycleVerdict {
  outcome: ReplicaReconcileOutcome;
  reopened: boolean;
  confirm: boolean;
}

/**
 * ADR-0570: one admission gate for the whole peer transport. Every configured replica shares the
 * peer host, so a replica's first transport failure closes the gate for all of them: while closed,
 * no reconciliation or subscription contacts the peer. At the retry time exactly one probe runs.
 * Success reopens the gate; failure doubles the wait up to the ceiling. A stopped or restarting
 * peer therefore sees one connection attempt per back-off period instead of one per replica and
 * cycle.
 *
 * A replica whose transport failure recurs after the peer answered anyone may have a problem of
 * its own. From then until it completes a cycle again, each of its transport failures is confirmed
 * with one immediate probe: if the peer answers, the failure is `held` on the replica's own
 * schedule and the gate stays open for the replicas that work; if not, it is a peer outage and
 * closes the gate like any first failure.
 */
export class ReplicaPeerBackoff {
  private failures = 0;
  private retryAtMs: number | null = null;
  private probing = false;
  private readonly ceilingMs: number;
  /** Counts every answer from the peer: a probe success or a cycle that was not unreachable. */
  private answers = 0;
  /** `answers` at each replica's first transport failure, until it completes a cycle again. */
  private readonly failedAtAnswer = new Map<string, number>();
  /** Replicas whose failures are their own until they complete a cycle again. */
  private readonly isolated = new Set<string>();
  /** Replicas the gate stopped scheduling; each runs once when the gate reopens. */
  private readonly parked = new Set<string>();

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
   * Records a finished cycle and returns the outcome the replica's schedule should use, and
   * whether the cycle reopened a closed gate. `confirm` asks the caller to probe the peer now and
   * pass the result to `confirmIsolated`. Only a `peer_unreachable` result parks the replica.
   */
  observeCycle(
    replicaId: string,
    outcome: ReplicaReconcileOutcome,
    now: number,
  ): ReplicaPeerCycleVerdict {
    if (outcome !== "peer_unreachable") {
      this.failedAtAnswer.delete(replicaId);
      this.isolated.delete(replicaId);
      return { outcome, reopened: this.answered(), confirm: false };
    }
    const first = this.failedAtAnswer.get(replicaId);
    if (first === undefined) this.failedAtAnswer.set(replicaId, this.answers);
    else if (this.answers > first) this.isolated.add(replicaId);
    if (this.isolated.has(replicaId)) return { outcome: "held", reopened: false, confirm: true };
    return this.park(replicaId, now);
  }

  /** Settles an isolated replica's transport failure with the confirming probe's result. */
  confirmIsolated(replicaId: string, reachable: boolean, now: number): ReplicaPeerCycleVerdict {
    if (reachable) return { outcome: "held", reopened: this.answered(), confirm: false };
    return this.park(replicaId, now);
  }

  /** Records the probe's result; returns true when the peer answered and the gate reopened. */
  observeProbe(reachable: boolean, now: number): boolean {
    if (reachable) return this.answered();
    this.close(now);
    return false;
  }

  /** Claims the single probe when the gate is closed and its retry time has come. */
  beginProbe(now: number): boolean {
    if (this.retryAtMs === null || this.probing || now < this.retryAtMs) return false;
    this.probing = true;
    return true;
  }

  /** The parked replicas to run once now that the gate is open; each is returned only once. */
  takeParked(): string[] {
    const parked = [...this.parked];
    this.parked.clear();
    return parked;
  }

  private park(replicaId: string, now: number): ReplicaPeerCycleVerdict {
    this.close(now);
    this.parked.add(replicaId);
    return { outcome: "peer_unreachable", reopened: false, confirm: false };
  }

  /**
   * Cycles that were already running when the gate closed fail for the same outage, so only the
   * first failure or a failed probe lengthens the wait.
   */
  private close(now: number): void {
    if (this.closed && !this.probing) return;
    this.failures += 1;
    this.probing = false;
    this.retryAtMs = now + Math.min(this.ceilingMs, this.baseMs * 2 ** (this.failures - 1));
  }

  private answered(): boolean {
    this.answers += 1;
    const reopened = this.closed;
    this.failures = 0;
    this.retryAtMs = null;
    this.probing = false;
    return reopened;
  }
}
