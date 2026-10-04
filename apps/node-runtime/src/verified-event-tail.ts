import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

type TailEvents = Pick<EventStore, "get" | "latest" | "list">;

interface TailCursor {
  seq: number;
  eventId: string;
  eventHash: string;
}

export interface VerifiedEventTailRead {
  /** True when the caller must discard everything it derived from earlier reads. */
  restarted: boolean;
  /** Matching events after the previous cursor, through the head observed by this read. */
  events: EventEnvelope[];
}

/**
 * In-memory cursor over the append-only project event chain for one set of event types.
 *
 * The first read, a read after `fullReadIntervalMs`, a clock rollback, and any anchor failure read
 * the whole history; other reads return only events after the cursor. The store assigns `seq`
 * inside serialized write transactions and rejects updates and deletes, so the events at or below
 * a verified head never change: the union of the earlier reads and the new tail equals one full
 * read. The anchor (same event ID, sequence, and stored hash, and a head not behind it) detects a
 * replaced or rolled-back store; the periodic full read bounds what an out-of-band rewrite below
 * the anchor could hide. The cursor is process memory only and never authorizes anything.
 */
export class VerifiedEventTail {
  private cursor: TailCursor | null = null;
  private fullReadAt: number | null = null;

  constructor(
    private readonly options: {
      types: readonly string[];
      /** Upper bound on the store head; larger histories fail as the full walk did. */
      maximumEvents: number;
      fullReadIntervalMs: number;
      boundMessage: string;
      now?: () => number;
    },
  ) {}

  reset(): void {
    this.cursor = null;
    this.fullReadAt = null;
  }

  read(events: TailEvents): VerifiedEventTailRead {
    const at = (this.options.now ?? Date.now)();
    if (!Number.isFinite(at)) throw new Error("The event tail clock is invalid.");
    const restarted = !this.anchorHolds(events, at);
    if (restarted) this.reset();
    const head = events.latest();
    if (head !== null && head.seq > this.options.maximumEvents)
      throw new Error(this.options.boundMessage);
    const observed: EventEnvelope[] = [];
    let afterSeq = this.cursor?.seq ?? 0;
    while (head !== null && afterSeq < head.seq) {
      const page = events.list({ afterSeq, limit: 1_000, types: this.options.types });
      for (const event of page) {
        if (event.seq <= afterSeq) throw new Error("The event store returned a backward page.");
        if (event.seq > head.seq) break;
        afterSeq = event.seq;
        // Stores that ignore the optional filter still yield the same result.
        if (this.options.types.includes(event.type)) observed.push(event);
      }
      if (page.length < 1_000 || page.at(-1)!.seq >= head.seq) break;
    }
    this.cursor =
      head === null ? null : { seq: head.seq, eventId: head.eventId, eventHash: head.eventHash };
    if (restarted) this.fullReadAt = at;
    return { restarted, events: observed };
  }

  private anchorHolds(events: TailEvents, at: number): boolean {
    if (
      this.fullReadAt === null ||
      at < this.fullReadAt ||
      at - this.fullReadAt >= this.options.fullReadIntervalMs
    )
      return false;
    // An empty observed history has nothing below its cursor to verify.
    if (this.cursor === null) return true;
    const anchor = events.get(this.cursor.eventId);
    const head = events.latest();
    return (
      anchor !== null &&
      head !== null &&
      head.seq >= this.cursor.seq &&
      anchor.seq === this.cursor.seq &&
      anchor.eventHash === this.cursor.eventHash
    );
  }
}
