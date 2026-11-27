import { type DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  computeEventHash,
  eventIdentity,
  sanitizeEventPayload,
  type EventDraft,
  type EventHashInput,
  type EventSchemaVersion,
} from "@lervo/event-contract";
import { type EventEnvelope, roomMentionRecordedEventId, validateSchema } from "@lervo/schemas";
import {
  type AppendEventResult,
  type EventChainReport,
  type ListEventsOptions,
} from "@lervo/storage-contract";

import { SQLiteEventChainVerifier } from "./chain-verifier.js";
import { EventStoreError } from "./errors.js";
import { rowToEvent } from "./row-codec.js";
import { sqliteRow, sqliteRows } from "./sqlite-row.js";
import { preparedStatement } from "./statement-cache.js";

const maximumListedTypes = 64;

/** Adjacent sequences in one result must form the stored predecessor chain. */
/**
 * One page of events of several types as a single statement, so the page comes from one read
 * snapshot: separate queries would let a writer commit between them and a later page skip an
 * event. Each branch reads one type through the type index. Parameters per branch are the project,
 * the type, the sequence bound, and the limit, then the overall limit.
 */
export function typeFilteredPageSql(typeCount: number, side: "after" | "before"): string {
  const [bound, order] = side === "after" ? [">", "ASC"] : ["<", "DESC"];
  const branch = `SELECT * FROM (SELECT * FROM events WHERE project_id = ? AND type = ? AND seq ${bound} ? ORDER BY seq ${order} LIMIT ?)`;
  return `${Array.from({ length: typeCount }, () => branch).join(" UNION ALL ")} ORDER BY seq ${order} LIMIT ?`;
}

function linkedEvents(events: EventEnvelope[]): EventEnvelope[] {
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]!,
      event = events[index]!;
    if (event.seq === previous.seq + 1 && event.previousHash !== previous.eventHash)
      throw new EventStoreError(
        "integrity_failed",
        `The event chain coordinates break at ${event.eventId}.`,
      );
  }
  return events;
}

export class SQLiteEventRepository {
  private readonly chainVerifier: SQLiteEventChainVerifier;

  constructor(
    private readonly database: DatabaseSync,
    private readonly projectId: string,
    private readonly writableEventSchemaVersion: EventSchemaVersion,
  ) {
    this.chainVerifier = new SQLiteEventChainVerifier(database, projectId);
  }

  append(draft: EventDraft): AppendEventResult {
    if (draft.projectId !== this.projectId) {
      throw new EventStoreError(
        "project_mismatch",
        `Event projectId ${draft.projectId} differs from store ${this.projectId}.`,
      );
    }
    if (draft.schemaVersion < 4 && Object.hasOwn(draft.payload, "convergenceContractVersion"))
      throw new EventStoreError(
        "event_schema_unsupported",
        "Convergence assignment provenance requires event schema version 4.",
      );
    // A mention's record takes the ID its mention derives, so a conversation note's attestation
    // finds it with one lookup (ADR-0648).
    if (
      draft.type === "room.mention.recorded" &&
      draft.eventId !== roomMentionRecordedEventId(String(draft.payload.mentionId))
    )
      throw new EventStoreError(
        "invalid_event",
        "A mention's record takes the ID its mention derives.",
      );
    const sanitized = sanitizeEventPayload(draft.type, draft.payload);
    const requestedIdentity = eventIdentity(draft, sanitized.payload);
    const effectiveDraft: EventDraft =
      this.writableEventSchemaVersion === 2 && draft.schemaVersion === 1
        ? ({ ...draft, schemaVersion: 2 } as EventDraft)
        : draft;
    const effectiveIdentity = eventIdentity(effectiveDraft, sanitized.payload);
    const existingRow = sqliteRow(
      preparedStatement(this.database, "SELECT * FROM events WHERE event_id = ?").get(
        draft.eventId,
      ),
    );
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
    if (draft.schemaVersion > this.writableEventSchemaVersion) {
      throw new EventStoreError(
        "event_schema_unsupported",
        "The requested event schema exceeds this writer activation.",
      );
    }

    const tail = this.verifiedTail();
    const seq = tail === null ? 1 : tail.seq + 1;
    const previousHash = tail === null ? null : tail.eventHash;
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
    preparedStatement(
      this.database,
      `
      INSERT INTO events (
        event_id, project_id, seq, run_id, session_id, type, occurred_at,
        actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
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

  /**
   * A new event extends only a predecessor whose content matches its hash and whose own
   * link reaches the event before it. Older history is checked when read or verified.
   */
  private verifiedTail(): EventEnvelope | null {
    const tail = this.latest();
    if (tail === null) return null;
    let predecessorHash: string | null | undefined = null;
    if (tail.seq > 1) {
      const row = sqliteRow(
        preparedStatement(
          this.database,
          "SELECT * FROM events WHERE project_id = ? AND seq = ?",
        ).get(this.projectId, tail.seq - 1),
      );
      predecessorHash = row === undefined ? undefined : rowToEvent(row).eventHash;
    }
    if (tail.previousHash !== predecessorHash)
      throw new EventStoreError(
        "integrity_failed",
        `The event chain coordinates break at ${tail.eventId}.`,
      );
    return tail;
  }

  /** The stored hash of the event at `seq`, or undefined when there is none; no decode. */
  private hashAt(seq: number): string | undefined {
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT event_hash FROM events WHERE project_id = ? AND seq = ?",
      ).get(this.projectId, seq),
    );
    return typeof row?.event_hash === "string" ? row.event_hash : undefined;
  }

  /**
   * ADR-0602: every event a caller reads is proven at use. Its own hash is checked when it is
   * decoded, and here its links to the stored events before and after it, so a row rewritten
   * after it was first verified is rejected wherever it is read.
   */
  private linkedToNeighbours(first: EventEnvelope, last: EventEnvelope = first): void {
    const previous = first.seq > 1 ? this.hashAt(first.seq - 1) : null;
    if (first.previousHash !== previous)
      throw new EventStoreError(
        "integrity_failed",
        `The event chain coordinates break at ${first.eventId}.`,
      );
    const next = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT previous_hash FROM events WHERE project_id = ? AND seq = ?",
      ).get(this.projectId, last.seq + 1),
    );
    if (next !== undefined && next.previous_hash !== last.eventHash)
      throw new EventStoreError(
        "integrity_failed",
        `The event chain coordinates break after ${last.eventId}.`,
      );
  }

  get(eventId: string): EventEnvelope | null {
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT * FROM events WHERE project_id = ? AND event_id = ?",
      ).get(this.projectId, eventId),
    );
    if (!row) return null;
    const event = rowToEvent(row);
    this.linkedToNeighbours(event);
    return event;
  }

  latest(): EventEnvelope | null {
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT * FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1",
      ).get(this.projectId),
    );
    return row ? rowToEvent(row) : null;
  }

  /** The head sequence only, with no row decode (ADR-0602 stall detection). */
  latestSeq(): number | null {
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT seq FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1",
      ).get(this.projectId),
    );
    return typeof row?.seq === "number" ? row.seq : null;
  }

  /** The head hash only: no row decode, schema validation or rehash (ADR-0597). */
  latestHash(): string | null {
    const row = sqliteRow(
      preparedStatement(
        this.database,
        "SELECT event_hash FROM events WHERE project_id = ? ORDER BY seq DESC LIMIT 1",
      ).get(this.projectId),
    );
    const hash = row?.event_hash;
    return typeof hash === "string" ? hash : null;
  }

  /** The head hash among events whose type is not in `types` (ADR-0598); no row decode. */
  latestHashExcluding(types: readonly string[]): string | null {
    if (types.length === 0) return this.latestHash();
    const row = sqliteRow(
      preparedStatement(
        this.database,
        `SELECT event_hash FROM events WHERE project_id = ? AND type NOT IN (${types
          .map(() => "?")
          .join(", ")}) ORDER BY seq DESC LIMIT 1`,
      ).get(this.projectId, ...types),
    );
    const hash = row?.event_hash;
    return typeof hash === "string" ? hash : null;
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
    const types = options.types === undefined ? undefined : [...new Set(options.types)];
    if (
      types !== undefined &&
      (types.length < 1 ||
        types.length > maximumListedTypes ||
        types.some((type) => typeof type !== "string" || type.length === 0))
    ) {
      throw new RangeError(
        `types must name between 1 and ${maximumListedTypes} non-empty event types.`,
      );
    }
    const conditions = ["project_id = ?"];
    const parameters: (string | number)[] = [this.projectId];
    if (options.runId !== undefined) {
      conditions.push("run_id = ?");
      parameters.push(options.runId);
    }
    if (types !== undefined) {
      conditions.push(`type IN (${types.map(() => "?").join(", ")})`);
      parameters.push(...types);
    }
    conditions.push("seq > ?");
    parameters.push(afterSeq, limit);
    // SQLite answers `type IN (two or more)` through the (project, seq) index and filters every
    // later row, a scan of the whole history; one branch per type uses the type index instead.
    const rows =
      types !== undefined && types.length > 1 && options.runId === undefined
        ? sqliteRows(
            preparedStatement(this.database, typeFilteredPageSql(types.length, "after")).all(
              ...types.flatMap((type) => [this.projectId, type, afterSeq, limit]),
              limit,
            ),
          )
        : sqliteRows(
            this.database
              .prepare(
                `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY seq LIMIT ?`,
              )
              .all(...parameters),
          );
    const events = linkedEvents(rows.map(rowToEvent));
    // A filtered page skips sequences, so each returned run of adjacent events is checked at its
    // edges; an unfiltered page is one run.
    if (events.length > 0 && options.runId === undefined && types === undefined)
      this.linkedToNeighbours(events[0]!, events.at(-1)!);
    else for (const event of events) this.linkedToNeighbours(event);
    return events;
  }

  listNewestFirst(options: {
    types: readonly string[];
    beforeSeq?: number;
    limit?: number;
  }): EventEnvelope[] {
    const types = [...new Set(options.types)];
    const limit = options.limit ?? 100;
    const beforeSeq = options.beforeSeq ?? Number.MAX_SAFE_INTEGER;
    if (types.length < 1 || types.length > maximumListedTypes || types.some((type) => !type))
      throw new RangeError(
        `types must name between 1 and ${maximumListedTypes} non-empty event types.`,
      );
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new RangeError("limit must be a safe integer between 1 and 1000.");
    if (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1)
      throw new RangeError("beforeSeq must be a safe integer of at least 1.");
    const rows = sqliteRows(
      preparedStatement(this.database, typeFilteredPageSql(types.length, "before")).all(
        ...types.flatMap((type) => [this.projectId, type, beforeSeq, limit]),
        limit,
      ),
    );
    const events = rows.map(rowToEvent);
    for (const event of events) this.linkedToNeighbours(event);
    return events;
  }

  verifyIntegrity(): EventChainReport {
    return this.chainVerifier.verify();
  }
}
