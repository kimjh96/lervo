import { lstat, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  computeEventHash,
  eventIdentity,
  eventWithoutHash,
  sanitizeEventPayload,
  type EventDraft,
} from "@roven/event-contract";
import { type EventEnvelope, type ProjectManifest, validateSchema } from "@roven/schemas";
import {
  type AppendEventResult,
  type EventChainReport,
  type EventStore,
  type EventStoreTransaction,
  type ListEventsOptions,
} from "@roven/storage-contract";

import { EventStoreError } from "./errors.js";
import { configureDatabase, migrateDatabase, storageSchemaVersion } from "./migrations.js";
import { requireString, rowToEvent } from "./row-codec.js";

export interface OpenEventStoreOptions {
  path: string;
  projectId: ProjectManifest["projectId"];
}

async function ensureDatabasePath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new EventStoreError(
        "integrity_failed",
        "SQLite 경로는 일반 파일이어야 하며 심볼릭 링크일 수 없습니다.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolutePath;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export class SQLiteEventStore implements EventStore {
  readonly path: string;
  readonly projectId: string;
  private closed = false;
  private transactionActive = false;

  private constructor(
    path: string,
    projectId: string,
    private readonly database: DatabaseSync,
  ) {
    this.path = path;
    this.projectId = projectId;
  }

  static async open(options: OpenEventStoreOptions): Promise<SQLiteEventStore> {
    const path = await ensureDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureDatabase(database);
      migrateDatabase(database);
      const store = new SQLiteEventStore(path, options.projectId, database);
      store.bindMetadata();
      store.verifyIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new EventStoreError("closed", "닫힌 event store는 사용할 수 없습니다.");
    }
  }

  private bindMetadata(): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const getMeta = this.database.prepare("SELECT value FROM store_meta WHERE key = ?");
      const storedVersion = getMeta.get("storage_schema_version")?.value;
      const storedProjectId = getMeta.get("project_id")?.value;
      const insertMeta = this.database.prepare(
        "INSERT INTO store_meta (key, value) VALUES (?, ?)",
      );
      if (storedVersion === undefined) {
        insertMeta.run("storage_schema_version", String(storageSchemaVersion));
      } else {
        const parsedVersion = Number(storedVersion);
        if (
          !Number.isSafeInteger(parsedVersion) ||
          parsedVersion < 1 ||
          parsedVersion > storageSchemaVersion
        ) {
          throw new EventStoreError(
            "integrity_failed",
            `지원하지 않는 event store schema입니다: ${String(storedVersion)}`,
          );
        }
        if (parsedVersion < storageSchemaVersion) {
          this.database.prepare("UPDATE store_meta SET value = ? WHERE key = ?").run(
            String(storageSchemaVersion),
            "storage_schema_version",
          );
        }
      }
      if (storedProjectId === undefined) {
        insertMeta.run("project_id", this.projectId);
      } else if (storedProjectId !== this.projectId) {
        throw new EventStoreError(
          "project_mismatch",
          `event store는 ${String(storedProjectId)}에 속하며 ${this.projectId}로 열 수 없습니다.`,
        );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private appendInTransaction(draft: EventDraft): AppendEventResult {
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
    const event: EventEnvelope = { ...withoutHash, eventHash: computeEventHash(withoutHash) };
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

  transact<T>(work: (transaction: EventStoreTransaction) => T): T {
    this.assertOpen();
    if (this.transactionActive) {
      throw new EventStoreError(
        "nested_transaction",
        "중첩 event store transaction은 지원하지 않습니다.",
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    this.transactionActive = true;
    try {
      const result = work({ append: (draft) => this.appendInTransaction(draft) });
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new EventStoreError(
          "transaction_async",
          "event store transaction callback은 동기 함수여야 합니다.",
        );
      }
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    } finally {
      this.transactionActive = false;
    }
  }

  append(draft: EventDraft): AppendEventResult {
    return this.transact((transaction) => transaction.append(draft));
  }

  journalMode(): string {
    this.assertOpen();
    const mode = this.database.prepare("PRAGMA journal_mode;").get()?.journal_mode;
    if (typeof mode !== "string") {
      throw new EventStoreError(
        "integrity_failed",
        "SQLite journal mode를 확인할 수 없습니다.",
      );
    }
    return mode;
  }

  get(eventId: string): EventEnvelope | null {
    this.assertOpen();
    const row = this.database.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId);
    return row ? rowToEvent(row) : null;
  }

  list(options: ListEventsOptions = {}): EventEnvelope[] {
    this.assertOpen();
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
    this.assertOpen();
    const quickCheck = this.database.prepare("PRAGMA quick_check;").get()?.quick_check;
    if (quickCheck !== "ok") {
      throw new EventStoreError(
        "integrity_failed",
        `SQLite quick_check가 실패했습니다: ${String(quickCheck)}`,
      );
    }
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

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
