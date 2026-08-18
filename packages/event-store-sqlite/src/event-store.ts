import { DatabaseSync } from "node:sqlite";

import { type EventDraft } from "@lervo/event-contract";
import { type ProjectManifest } from "@lervo/schemas";
import {
  type AcknowledgeOutboxRequest,
  type AcknowledgeOutboxResult,
  type AppendEventResult,
  type ClaimOutboxRequest,
  type EnqueueOutboxRequest,
  type EnqueueOutboxResult,
  type EventChainReport,
  type ListEventsOptions,
  type ListOutboxOptions,
  type OutboxDelivery,
  type OutboxStore,
  type OutboxTransaction,
  type PurgeAcknowledgedOutboxRequest,
  type PurgeAcknowledgedOutboxResult,
  type RescheduleOutboxRequest,
  type RescheduleOutboxResult,
} from "@lervo/storage-contract";

import { bindDatabaseMetadata, ensureDatabasePath } from "./database-lifecycle.js";
import { EventStoreError } from "./errors.js";
import { SQLiteEventRepository } from "./event-repository.js";
import { configureDatabase, migrateDatabase } from "./migrations.js";
import { SQLiteOutboxRepository } from "./outbox.js";

export interface OpenEventStoreOptions {
  path: string;
  projectId: ProjectManifest["projectId"];
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export class SQLiteEventStore implements OutboxStore {
  readonly path: string;
  readonly projectId: string;
  private closed = false;
  private transactionActive = false;
  private readonly events: SQLiteEventRepository;
  private readonly outbox: SQLiteOutboxRepository;

  private constructor(
    path: string,
    projectId: string,
    private readonly database: DatabaseSync,
  ) {
    this.path = path;
    this.projectId = projectId;
    this.events = new SQLiteEventRepository(database, projectId);
    this.outbox = new SQLiteOutboxRepository(database);
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
      bindDatabaseMetadata(database, options.projectId);
      const store = new SQLiteEventStore(path, options.projectId, database);
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

  transact<T>(work: (transaction: OutboxTransaction) => T): T {
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
      const result = work({
        append: (draft) => this.events.append(draft),
        enqueue: (request) => this.outbox.enqueue(request),
        claim: (request) => this.outbox.claim(request),
        acknowledge: (request) => this.outbox.acknowledge(request),
        reschedule: (request) => this.outbox.reschedule(request),
        purgeAcknowledged: (request) => this.outbox.purgeAcknowledged(request),
      });
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

  enqueue(request: EnqueueOutboxRequest): EnqueueOutboxResult {
    return this.transact((transaction) => transaction.enqueue(request));
  }

  claim(request: ClaimOutboxRequest): OutboxDelivery[] {
    return this.transact((transaction) => transaction.claim(request));
  }

  acknowledge(request: AcknowledgeOutboxRequest): AcknowledgeOutboxResult {
    return this.transact((transaction) => transaction.acknowledge(request));
  }

  reschedule(request: RescheduleOutboxRequest): RescheduleOutboxResult {
    return this.transact((transaction) => transaction.reschedule(request));
  }

  purgeAcknowledged(
    request: PurgeAcknowledgedOutboxRequest,
  ): PurgeAcknowledgedOutboxResult {
    return this.transact((transaction) => transaction.purgeAcknowledged(request));
  }

  get(eventId: string) {
    this.assertOpen();
    return this.events.get(eventId);
  }

  list(options: ListEventsOptions = {}) {
    this.assertOpen();
    return this.events.list(options);
  }

  listOutbox(options: ListOutboxOptions = {}): OutboxDelivery[] {
    this.assertOpen();
    return this.outbox.list(options);
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

  verifyIntegrity(): EventChainReport {
    this.assertOpen();
    const quickCheck = this.database.prepare("PRAGMA quick_check;").get()?.quick_check;
    if (quickCheck !== "ok") {
      throw new EventStoreError(
        "integrity_failed",
        `SQLite quick_check가 실패했습니다: ${String(quickCheck)}`,
      );
    }
    const foreignKeyViolation = this.database.prepare("PRAGMA foreign_key_check;").get();
    if (foreignKeyViolation !== undefined) {
      throw new EventStoreError(
        "integrity_failed",
        "SQLite foreign key 검사가 실패했습니다.",
      );
    }
    this.outbox.verifyIntegrity();
    return this.events.verifyIntegrity();
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
