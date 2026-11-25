// The resident's queue of hosted turn usage on its way to the event store (ADR-0632, S2b). The
// decoder path never waits on storage: decoded turns are queued and recorded one batch at a time.
import type { HostedTurnUsage } from "@lervo/adapter-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";

import type { HostedTurnUsageOutcome } from "./hosted-turn-usage-events.js";

/**
 * Usage records waiting or being recorded at once; more are dropped and counted, so a stalled
 * store holds no more.
 */
export const MAX_QUEUED_TURN_USAGE = 1024;

/** Tries of one batch: a busy or briefly failing store gets two retries, a second apart. */
export const TURN_USAGE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

/** Records each session's turn usage in order, without blocking the caller. */
export class TurnUsageQueue {
  private readonly batches: {
    sessionId: string;
    accounting: ResourceAccountingDescriptor;
    usage: readonly HostedTurnUsage[];
  }[] = [];
  private queued = 0;
  private draining: Promise<void> | null = null;
  /** Records never stored: the queue was full, recording failed, or the event screen refused them. */
  dropped = 0;

  constructor(
    private readonly record: (
      sessionId: string,
      accounting: ResourceAccountingDescriptor,
      usage: readonly HostedTurnUsage[],
    ) => Promise<HostedTurnUsageOutcome>,
    private readonly retryDelayMs: number = RETRY_DELAY_MS,
  ) {}

  push(
    sessionId: string,
    accounting: ResourceAccountingDescriptor,
    usage: readonly HostedTurnUsage[],
  ): void {
    const kept = usage.slice(0, MAX_QUEUED_TURN_USAGE - this.queued);
    this.dropped += usage.length - kept.length;
    if (kept.length === 0) return;
    this.batches.push({ sessionId, accounting, usage: kept });
    this.queued += kept.length;
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
  }

  /** Settles once every queued batch has been recorded or dropped. */
  async idle(): Promise<void> {
    while (this.draining !== null) await this.draining;
  }

  /**
   * Records one batch. A store failure, thrown or reported, retries the whole batch; records it
   * already holds count as duplicates, so nothing is recorded twice. After the last try the
   * batch's unrecorded records count as dropped.
   */
  private async recordWithRetries(batch: {
    sessionId: string;
    accounting: ResourceAccountingDescriptor;
    usage: readonly HostedTurnUsage[];
  }): Promise<void> {
    for (let attempt = 1; attempt <= TURN_USAGE_ATTEMPTS; attempt += 1) {
      // A thrown failure, such as a store that cannot open, retries like a reported one.
      const outcome: HostedTurnUsageOutcome | null = await this.record(
        batch.sessionId,
        batch.accounting,
        batch.usage,
      ).catch(() => null);
      if (outcome?.status === "recorded") {
        this.dropped += outcome.dropped;
        return;
      }
      if (outcome !== null && outcome.status !== "storage_failed") {
        if (outcome.status === "descriptor_unavailable") this.dropped += batch.usage.length;
        return;
      }
      if (attempt === TURN_USAGE_ATTEMPTS) {
        const settled = outcome === null ? 0 : outcome.recorded + outcome.duplicates;
        this.dropped += batch.usage.length - settled;
        return;
      }
      await new Promise((done) => setTimeout(done, this.retryDelayMs * attempt));
    }
  }

  private async drain(): Promise<void> {
    for (let batch = this.batches.shift(); batch !== undefined; batch = this.batches.shift()) {
      await this.recordWithRetries(batch);
      // The batch being recorded still counts toward the bound until it settles.
      this.queued -= batch.usage.length;
    }
  }
}
