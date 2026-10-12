import type { DatabaseSync } from "node:sqlite";

import type { EventChainReport } from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import { rowToEvent } from "./row-codec.js";
import { sqliteRows } from "./sqlite-row.js";
import { preparedStatement } from "./statement-cache.js";

const integrityPageSize = 1_000;

/**
 * Explicit complete-history verification. Each row is decoded through the hash-checking
 * row boundary, and every sequence and predecessor link is checked from the first event.
 */
export class SQLiteEventChainVerifier {
  constructor(
    private readonly database: DatabaseSync,
    private readonly projectId: string,
  ) {}

  verify(): EventChainReport {
    const page = preparedStatement(
      this.database,
      "SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    );
    let previousHash: string | null = null;
    let eventCount = 0;
    while (true) {
      const rows = sqliteRows(page.all(this.projectId, eventCount, integrityPageSize));
      if (rows.length === 0) break;
      for (const row of rows) {
        const event = rowToEvent(row);
        eventCount += 1;
        if (event.seq !== eventCount || event.previousHash !== previousHash) {
          throw new EventStoreError(
            "integrity_failed",
            `The event chain coordinates break at ${event.eventId}.`,
          );
        }
        previousHash = event.eventHash;
      }
    }
    return { valid: true, eventCount, headHash: previousHash };
  }
}
