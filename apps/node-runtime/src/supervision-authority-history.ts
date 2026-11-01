import { lstat } from "node:fs/promises";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

const MAXIMUM_OBSERVATION_PASSES = 16;
/** Wake-up for an anchor-and-tail check that observes appended authority events without a hint. */
const TAIL_AUDIT_INTERVAL_MS = 60_000;
/** Re-verification of every historical byte; also forced by clock rollback or anchor failure. */
const FULL_AUDIT_INTERVAL_MS = 900_000;
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
 * Every read verifies each appended link from the anchor, and the full audit streams the whole
 * chain from the first event. Only rows the retention selects are kept, under a byte bound, so a
 * long history costs streaming time at most once per audit interval but never fails the read.
 */
export class SupervisionAuthorityHistory {
  private cursor: EventEnvelope | null = null;
  private retained: EventEnvelope[] = [];
  private bytes = 0;
  private auditedAt: number | null = null;
  private checkedAt: number | null = null;
  private databaseIdentity: string | null = null;

  constructor(
    private readonly events: EventStore,
    private readonly databasePath: string,
    private readonly projectId: string,
    private readonly now: () => number = Date.now,
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

  nextAuditAt(): number | null {
    return this.checkedAt === null ? null : this.checkedAt + TAIL_AUDIT_INTERVAL_MS;
  }

  private reset(): void {
    this.cursor = null;
    this.retained = [];
    this.bytes = 0;
    this.auditedAt = null;
    this.checkedAt = null;
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
    const at = this.now();
    if (!Number.isFinite(at)) throw new Error("The supervision authority clock is invalid.");
    // Appended events are always read and chain-verified from the anchor, so a revocation or any
    // other authority change is never skipped; the full audit only re-proves bytes below it.
    if (
      this.auditedAt === null ||
      at < this.auditedAt ||
      (this.checkedAt !== null && at < this.checkedAt) ||
      at - this.auditedAt >= FULL_AUDIT_INTERVAL_MS
    )
      this.reset();
    else if (this.cursor !== null) {
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
    this.auditedAt ??= at;
    this.checkedAt = at;
    return structuredClone(this.retained);
  }
}
