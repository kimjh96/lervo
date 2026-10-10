import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import type { EventChainReport } from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import { rowToEvent } from "./row-codec.js";
import { sqliteRows } from "./sqlite-row.js";

const integrityPageSize = 1_000;

interface VerifiedPage {
  bytesHash: string;
  previousHash: string | null;
  eventCount: number;
  headHash: string;
}

/** Connection-local receipts avoid revalidating identical bytes, never reading fewer rows. */
export class SQLiteEventChainVerifier {
  private pages = new Map<number, VerifiedPage>();

  constructor(
    private readonly database: DatabaseSync,
    private readonly projectId: string,
  ) {}

  verify(): EventChainReport {
    const verified = new Map<number, VerifiedPage>();
    let previousHash: string | null = null;
    let eventCount = 0;
    const page = this.database.prepare(
      "SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    );
    try {
      while (true) {
        const rows = sqliteRows(page.all(this.projectId, eventCount, integrityPageSize));
        if (rows.length === 0) break;
        const afterSeq = eventCount;
        const predecessor = previousHash;
        // Hash the freshly read raw columns, including payloads, rather than trusting stored hashes.
        const bytesHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
        const cached = this.pages.get(afterSeq);
        if (cached?.bytesHash === bytesHash && cached.previousHash === predecessor) {
          eventCount = cached.eventCount;
          previousHash = cached.headHash;
          verified.set(afterSeq, cached);
          continue;
        }
        const cachedLength = cached === undefined ? 0 : cached.eventCount - afterSeq;
        let reused = 0;
        if (
          cached &&
          cached.previousHash === predecessor &&
          cachedLength > 0 &&
          cachedLength < rows.length &&
          createHash("sha256")
            .update(JSON.stringify(rows.slice(0, cachedLength)))
            .digest("hex") === cached.bytesHash
        ) {
          // A growing tail page can reuse only its freshly read exact prefix.
          eventCount = cached.eventCount;
          previousHash = cached.headHash;
          reused = cachedLength;
        }
        for (const row of rows.slice(reused)) {
          const event = rowToEvent(row);
          eventCount += 1;
          if (event.seq !== eventCount || event.previousHash !== previousHash) {
            throw new EventStoreError(
              "integrity_failed",
              `The event chain coordinates break at ${event.eventId}.`,
            );
          }
          if (event.eventHash !== computeEventHash(eventWithoutHash(event))) {
            throw new EventStoreError(
              "integrity_failed",
              `The event hash does not match at ${event.eventId}.`,
            );
          }
          previousHash = event.eventHash;
        }
        verified.set(afterSeq, {
          bytesHash,
          previousHash: predecessor,
          eventCount,
          headHash: previousHash!,
        });
      }
      // Replace the previous observation; removed pages and source bodies are never retained.
      this.pages = verified;
      return { valid: true, eventCount, headHash: previousHash };
    } catch (error) {
      this.pages.clear();
      throw error;
    }
  }
}
