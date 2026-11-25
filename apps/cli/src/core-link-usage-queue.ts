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

  private async drain(): Promise<void> {
    for (let batch = this.batches.shift(); batch !== undefined; batch = this.batches.shift()) {
      try {
        const outcome = await this.record(batch.sessionId, batch.accounting, batch.usage);
        if (outcome.status === "recorded") this.dropped += outcome.dropped;
        else if (outcome.status === "descriptor_unavailable") this.dropped += batch.usage.length;
      } catch {
        this.dropped += batch.usage.length;
      }
      // The batch being recorded still counts toward the bound until it settles.
      this.queued -= batch.usage.length;
    }
  }
}
