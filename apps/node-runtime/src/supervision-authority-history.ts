import { lstat } from "node:fs/promises";
import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

const MAXIMUM_OBSERVATION_PASSES = 16;

/** Rebuildable authority projection; hints and cached rows never replace canonical events. */
export class SupervisionAuthorityHistory {
  private cursor: EventEnvelope | null = null;
  private retained: EventEnvelope[] = [];
  private bytes = 0;
  private auditedAt: number | null = null;
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
    return this.auditedAt === null ? null : this.auditedAt + 60_000;
  }

  private reset(): void {
    this.cursor = null;
    this.retained = [];
    this.bytes = 0;
    this.auditedAt = null;
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
          event.previousHash !== (this.cursor?.eventHash ?? null) ||
          computeEventHash(eventWithoutHash(event)) !== event.eventHash
        )
          throw new Error("The supervision authority event chain is invalid.");
        if (
          typeof this.retention === "function"
            ? this.retention(event)
            : this.retention === "execution" ||
              event.type === "work.supervision.mandate.installed" ||
              event.type.startsWith("organization.") ||
              event.type === "workstream.snapshot.recorded"
        ) {
          const copy = structuredClone(event);
          this.bytes += Buffer.byteLength(JSON.stringify(copy));
          if (this.bytes > 32 * 1024 * 1024)
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
    if (this.auditedAt === null || at < this.auditedAt || at - this.auditedAt >= 60_000)
      this.reset();
    else if (this.cursor !== null) {
      const anchor = this.events.get(this.cursor.eventId);
      const tail = this.events.latest();
      if (
        anchor === null ||
        tail === null ||
        tail.seq < this.cursor.seq ||
        anchor.seq !== this.cursor.seq ||
        anchor.eventHash !== this.cursor.eventHash ||
        computeEventHash(eventWithoutHash(anchor)) !== this.cursor.eventHash
      )
        this.reset();
    }
    // Workers append events while the owner observes, so follow the tail until one pass ends at
    // a stable head instead of failing on the first concurrent append.
    for (let pass = 1; ; pass += 1) {
      const head = this.events.latest();
      if ((head?.seq ?? 0) > 100_000)
        throw new Error("The supervision authority history exceeds its source bound.");
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
    return structuredClone(this.retained);
  }
}
