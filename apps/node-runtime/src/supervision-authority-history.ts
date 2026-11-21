import { lstat } from "node:fs/promises";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

const MAXIMUM_OBSERVATION_PASSES = 16;
/** Bound on retained rows; the chain is streamed, so history length itself is never bounded. */
const MAXIMUM_RETAINED_BYTES = 32 * 1024 * 1024;

/** Event types the default authority retention keeps for mandate, team, and workstream checks. */
export function isSupervisionAuthorityEvent(event: EventEnvelope): boolean {
  return (
    event.type === "work.supervision.mandate.installed" ||
    event.type.startsWith("organization.") ||
    event.type === "workstream.snapshot.recorded"
  );
}

/**
 * Rebuildable authority projection; hints and cached rows never replace canonical events.
 *
 * ADR-0602: the first read streams and verifies the whole chain from the first event, and so does
 * any read whose anchor no longer matches the store. Every other read verifies each appended link
 * from the anchor. Nothing re-reads history on a timer; the event-store change channel wakes the
 * owner for appended events. Only rows the retention selects are kept, under a byte bound.
 */
export class SupervisionAuthorityHistory {
  private cursor: EventEnvelope | null = null;
  private retained: EventEnvelope[] = [];
  private bytes = 0;
  private databaseIdentity: string | null = null;

  constructor(
    private readonly events: EventStore,
    private readonly databasePath: string,
    private readonly projectId: string,
    private readonly retention:
      "authority" | "execution" | ((event: EventEnvelope) => boolean) = "authority",
  ) {}

  async read(): Promise<EventEnvelope[]> {
    try {
      return await this.readVerified();
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  private reset(): void {
    this.cursor = null;
    this.retained = [];
    this.bytes = 0;
  }

  private readThrough(head: EventEnvelope | null): void {
    while ((this.cursor?.seq ?? 0) < (head?.seq ?? 0)) {
      const page = this.events.list({ afterSeq: this.cursor?.seq ?? 0, limit: 1_000 });
      const observed = page.filter((event) => event.seq <= head!.seq);
      if (observed.length === 0)
        throw new Error("The supervision authority history is incomplete.");
      for (const event of observed) {
        if (
          event.projectId !== this.projectId ||
          event.seq !== (this.cursor?.seq ?? 0) + 1 ||
          event.previousHash !== (this.cursor?.eventHash ?? null)
        )
          throw new Error("The supervision authority event chain is invalid.");
        if (
          typeof this.retention === "function"
            ? this.retention(event)
            : this.retention === "execution" || isSupervisionAuthorityEvent(event)
        ) {
          const copy = structuredClone(event);
          this.bytes += Buffer.byteLength(JSON.stringify(copy));
          if (this.bytes > MAXIMUM_RETAINED_BYTES)
            throw new Error("The supervision authority projection exceeds its byte bound.");
          this.retained.push(copy);
        }
        this.cursor = structuredClone(event);
      }
    }
  }

  private async readVerified(): Promise<EventEnvelope[]> {
    const metadata = await lstat(this.databasePath, { bigint: true });
    const identity = `${metadata.dev}:${metadata.ino}`;
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (this.databaseIdentity !== null && identity !== this.databaseIdentity)
    )
      throw new Error("The supervision event database was replaced; reopen the runtime.");
    this.databaseIdentity = identity;
    // Appended events are always read and chain-verified from the anchor, so a revocation or any
    // other authority change is never skipped.
    if (this.cursor !== null) {
      const anchor = this.events.get(this.cursor.eventId);
      const tail = this.events.latest();
      if (
        anchor === null ||
        tail === null ||
        tail.seq < this.cursor.seq ||
        anchor.seq !== this.cursor.seq ||
        anchor.eventHash !== this.cursor.eventHash
      )
        this.reset();
    }
    // Workers append events while the owner observes, so follow the tail until one pass ends at
    // a stable head instead of failing on the first concurrent append.
    for (let pass = 1; ; pass += 1) {
      const head = this.events.latest();
      this.readThrough(head);
      const confirmed = this.events.latest();
      if (
        confirmed?.eventId === head?.eventId &&
        confirmed?.seq === head?.seq &&
        confirmed?.eventHash === head?.eventHash &&
        this.cursor?.eventHash === head?.eventHash
      )
        break;
      if (pass >= MAXIMUM_OBSERVATION_PASSES)
        throw new Error("The supervision authority history changed while being observed.");
    }
    return structuredClone(this.retained);
  }
}
