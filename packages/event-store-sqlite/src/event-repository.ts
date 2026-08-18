import { type DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  computeEventHash,
  eventIdentity,
  eventWithoutHash,
  sanitizeEventPayload,
  type EventDraft,
} from "@roven/event-contract";
import { type EventEnvelope, validateSchema } from "@roven/schemas";
import {
  type AppendEventResult,
  type EventChainReport,
  type ListEventsOptions,
} from "@roven/storage-contract";

import { EventStoreError } from "./errors.js";
import { requireString, rowToEvent } from "./row-codec.js";

export class SQLiteEventRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly projectId: string,
  ) {}

  append(draft: EventDraft): AppendEventResult {
    if (draft.projectId !== this.projectId) {
      throw new EventStoreError(
        "project_mismatch",
        `event의 projectId ${draft.projectId}가 store ${this.projectId}와 다릅니다.`,
      );
    }
    const sanitized = sanitizeEventPayload(draft.type, draft.payload);
    const identity = eventIdentity(draft, sanitized.payload);
    const existingRow = this.database
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get(draft.eventId);
    if (existingRow) {
      const existing = rowToEvent(existingRow);
      if (eventIdentity(existing, existing.payload) !== identity) {
        throw new EventStoreError(
          "event_id_conflict",
          `${draft.eventId}가 다른 내용으로 이미 저장되어 있습니다.`,
        );
      }
      return { event: existing, inserted: false, redactions: sanitized.redactions };
    }

    const tailRow = this.database
      .prepare("SELECT seq, event_hash FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1")
      .get(this.projectId);
    const seqValue = tailRow?.seq;
    if (
      seqValue !== undefined &&
      (typeof seqValue !== "number" || !Number.isSafeInteger(seqValue))
    ) {
      throw new EventStoreError("integrity_failed", "event tail sequence가 안전한 정수가 아닙니다.");
    }
    const seq = typeof seqValue === "number" ? seqValue + 1 : 1;
    const previousHash = tailRow ? requireString(tailRow, "event_hash") : null;
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      ...draft,
      payload: sanitized.payload,
      seq,
      previousHash,
    };
    const event: EventEnvelope = {
      ...withoutHash,
      eventHash: computeEventHash(withoutHash),
    };
    const validation = validateSchema("event", event);
    if (!validation.valid) {
      throw new EventStoreError(
        "invalid_event",
        validation.errors
          .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
          .join("; "),
      );
    }
    this.database.prepare(`
      INSERT INTO events (
        event_id, project_id, seq, run_id, session_id, type, occurred_at,
        actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

  list(options: ListEventsOptions = {}): EventEnvelope[] {
    const afterSeq = options.afterSeq ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new RangeError("afterSeq는 0 이상의 안전한 정수여야 합니다.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError("limit은 1 이상 1000 이하의 안전한 정수여야 합니다.");
    }
    const rows = options.runId
      ? this.database
          .prepare(
            "SELECT * FROM events WHERE project_id = ? AND run_id = ? AND seq > ? ORDER BY seq LIMIT ?",
          )
          .all(this.projectId, options.runId, afterSeq, limit)
      : this.database
          .prepare(
            "SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?",
          )
          .all(this.projectId, afterSeq, limit);
    return rows.map(rowToEvent);
  }

  verifyIntegrity(): EventChainReport {
    const events = this.database
      .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY seq")
      .all(this.projectId)
      .map(rowToEvent);
    let previousHash: string | null = null;
    for (const [index, event] of events.entries()) {
      if (event.seq !== index + 1 || event.previousHash !== previousHash) {
        throw new EventStoreError(
          "integrity_failed",
          `event chain 좌표가 ${event.eventId}에서 끊겼습니다.`,
        );
      }
      if (event.eventHash !== computeEventHash(eventWithoutHash(event))) {
        throw new EventStoreError(
          "integrity_failed",
          `event hash가 ${event.eventId}에서 일치하지 않습니다.`,
        );
      }
      previousHash = event.eventHash;
    }
    return { valid: true, eventCount: events.length, headHash: previousHash };
  }
}
