import { type DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  computeEventHash,
  eventIdentity,
  eventWithoutHash,
  sanitizeEventPayload,
  type EventDraft,
  type EventHashInput,
} from "@lervo/event-contract";
import { type EventEnvelope, validateSchema } from "@lervo/schemas";
import {
  type AppendEventResult,
  type EventChainReport,
  type ListEventsOptions,
} from "@lervo/storage-contract";

import { EventStoreError } from "./errors.js";
import { requireString, rowToEvent } from "./row-codec.js";

const integrityPageSize = 1000;

export class SQLiteEventRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly projectId: string,
    private readonly writableEventSchemaVersion: 1 | 2,
  ) {}

  append(draft: EventDraft): AppendEventResult {
    if (draft.projectId !== this.projectId) {
      throw new EventStoreError(
        "project_mismatch",
        `Event projectId ${draft.projectId} differs from store ${this.projectId}.`,
      );
    }
    const sanitized = sanitizeEventPayload(draft.type, draft.payload);
    const requestedIdentity = eventIdentity(draft, sanitized.payload);
    const effectiveDraft: EventDraft =
      this.writableEventSchemaVersion === 2 && draft.schemaVersion === 1
        ? ({ ...draft, schemaVersion: 2 } as EventDraft)
        : draft;
    const effectiveIdentity = eventIdentity(effectiveDraft, sanitized.payload);
    const existingRow = this.database
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get(draft.eventId);
    if (existingRow) {
      const existing = rowToEvent(existingRow);
      const existingIdentity = eventIdentity(existing, existing.payload);
      if (existingIdentity !== requestedIdentity && existingIdentity !== effectiveIdentity) {
        throw new EventStoreError(
          "event_id_conflict",
          `${draft.eventId} is already stored with different content.`,
        );
      }
      return { event: existing, inserted: false, redactions: sanitized.redactions };
    }
    if (this.writableEventSchemaVersion === 1 && draft.schemaVersion !== 1) {
      throw new EventStoreError(
        "event_schema_unsupported",
        "This writer emits only event schema version 1.",
      );
    }

    const tailRow = this.database
      .prepare("SELECT seq, event_hash FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1")
      .get(this.projectId);
    const seqValue = tailRow?.seq;
    if (
      seqValue !== undefined &&
      (typeof seqValue !== "number" || !Number.isSafeInteger(seqValue))
    ) {
      throw new EventStoreError(
        "integrity_failed",
        "The event tail sequence is not a safe integer.",
      );
    }
    const seq = typeof seqValue === "number" ? seqValue + 1 : 1;
    const previousHash = tailRow ? requireString(tailRow, "event_hash") : null;
    const withoutHash: EventHashInput = {
      ...effectiveDraft,
      payload: sanitized.payload,
      seq,
      previousHash,
    };
    const event: EventEnvelope = {
      ...withoutHash,
      eventHash: computeEventHash(withoutHash),
    } as EventEnvelope;
    const validation = validateSchema("event", event);
    if (!validation.valid) {
      throw new EventStoreError(
        "invalid_event",
        validation.errors
          .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
          .join("; "),
      );
    }
    this.database
      .prepare(
        `
      INSERT INTO events (
        event_id, project_id, seq, run_id, session_id, type, occurred_at,
        actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        event.eventId,
        event.projectId,
        event.seq,
        event.runId,
        event.sessionId,
        event.type,
        event.occurredAt,
        canonicalJson(event.actor),
        event.schemaVersion,
        event.policyVersion,
        canonicalJson(event.payload),
        event.previousHash,
        event.eventHash,
      );
    return { event, inserted: true, redactions: sanitized.redactions };
  }

  get(eventId: string): EventEnvelope | null {
    const row = this.database.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId);
    return row ? rowToEvent(row) : null;
  }

  latest(): EventEnvelope | null {
    const row = this.database
      .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1")
      .get(this.projectId);
    return row ? rowToEvent(row) : null;
  }

  list(options: ListEventsOptions = {}): EventEnvelope[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new RangeError("afterSeq must be a safe integer of at least 0.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError("limit must be a safe integer between 1 and 1000.");
    }
    const rows = options.runId
      ? this.database
          .prepare(
            "SELECT * FROM events WHERE project_id = ? AND run_id = ? AND seq > ? ORDER BY seq LIMIT ?",
          )
          .all(this.projectId, options.runId, afterSeq, limit)
      : this.database
          .prepare("SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?")
          .all(this.projectId, afterSeq, limit);
    return rows.map(rowToEvent);
  }

  verifyIntegrity(): EventChainReport {
    let previousHash: string | null = null;
    let eventCount = 0;
    const page = this.database.prepare(
      "SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    );
    while (true) {
      const rows = page.all(this.projectId, eventCount, integrityPageSize);
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
        if (event.eventHash !== computeEventHash(eventWithoutHash(event))) {
          throw new EventStoreError(
            "integrity_failed",
            `The event hash does not match at ${event.eventId}.`,
          );
        }
        previousHash = event.eventHash;
      }
    }
    return { valid: true, eventCount, headHash: previousHash };
  }
}
