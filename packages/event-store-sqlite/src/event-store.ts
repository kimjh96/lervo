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
import { configureDatabase, migrateDatabase, storageSchemaVersion } from "./migrations.js";
import { SQLiteOutboxRepository } from "./outbox.js";
import { openReadOnlyEventDatabase } from "./read-only-database.js";
import { sqliteRow } from "./sqlite-row.js";

export interface OpenEventStoreOptions {
  path: string;
  projectId: ProjectManifest["projectId"];
  writableEventSchemaVersion?: 1 | 2 | 3 | 4 | 5 | 6;
  checkpointEachCommit?: boolean;
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
    writableEventSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6,
    private readonly readOnly = false,
  ) {
    this.path = path;
    this.projectId = projectId;
    this.events = new SQLiteEventRepository(database, projectId, writableEventSchemaVersion);
    this.outbox = new SQLiteOutboxRepository(database);
  }

  static async open(options: OpenEventStoreOptions): Promise<SQLiteEventStore> {
    if (![1, 2, 3, 4, 5, 6].includes(options.writableEventSchemaVersion ?? 1)) {
      throw new EventStoreError(
        "event_schema_unsupported",
        "The writer activation version is unsupported.",
      );
    }
    const path = await ensureDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureDatabase(database);
      if (options.checkpointEachCommit)
        database.exec("PRAGMA wal_autocheckpoint = 1; PRAGMA journal_size_limit = 0;");
      migrateDatabase(database);
      bindDatabaseMetadata(database, options.projectId);
      const store = new SQLiteEventStore(
        path,
        options.projectId,
        database,
        options.writableEventSchemaVersion ?? 1,
      );
      store.verifyIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static async openReadOnly(
    options: Pick<OpenEventStoreOptions, "path" | "projectId">,
  ): Promise<SQLiteEventStore> {
    const { path, database } = await openReadOnlyEventDatabase(options);
    try {
      const store = new SQLiteEventStore(path, options.projectId, database, 3, true);
      store.verifyIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new EventStoreError("closed", "A closed event store cannot be used.");
    }
  }

  transact<T>(work: (transaction: OutboxTransaction) => T): T {
    this.assertOpen();
    if (this.readOnly)
      throw new EventStoreError(
        "read_only",
        "This event handle cannot mutate the observed repository.",
      );
    if (this.transactionActive) {
      throw new EventStoreError(
        "nested_transaction",
        "Nested event store transactions are not supported.",
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    this.transactionActive = true;
    try {
      const result = work({
        append: (draft) => this.events.append(draft),
        enqueue: (request) => this.outbox.enqueue(request),
        outstandingCount: (destinationId) => this.outbox.outstandingCount(destinationId),
        claim: (request) => this.outbox.claim(request),
        acknowledge: (request) => this.outbox.acknowledge(request),
        reschedule: (request) => this.outbox.reschedule(request),
        purgeAcknowledged: (request) => this.outbox.purgeAcknowledged(request),
      });
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new EventStoreError(
          "transaction_async",
          "The event store transaction callback must be synchronous.",
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

  outstandingCount(destinationId: string): number {
    this.assertOpen();
    return this.outbox.outstandingCount(destinationId);
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

  purgeAcknowledged(request: PurgeAcknowledgedOutboxRequest): PurgeAcknowledgedOutboxResult {
    return this.transact((transaction) => transaction.purgeAcknowledged(request));
  }

  get(eventId: string) {
    this.assertOpen();
    return this.events.get(eventId);
  }

  latest() {
    this.assertOpen();
    return this.events.latest();
  }

  list(options: ListEventsOptions = {}) {
    this.assertOpen();
    return this.events.list(options);
  }

  listOutbox(options: ListOutboxOptions = {}): OutboxDelivery[] {
    this.assertOpen();
    return this.outbox.list(options);
  }

  getOutbox(eventId: string, destinationId: string): OutboxDelivery | null {
    this.assertOpen();
    return this.outbox.get(eventId, destinationId);
  }

  journalMode(): string {
    this.assertOpen();
    const mode = sqliteRow(this.database.prepare("PRAGMA journal_mode;").get())?.journal_mode;
    if (typeof mode !== "string") {
      throw new EventStoreError("integrity_failed", "The SQLite journal mode cannot be inspected.");
    }
    return mode;
  }

  verifyIntegrity(): EventChainReport {
    this.assertOpen();
    const metadata = this.database.prepare("SELECT value FROM store_meta WHERE key = ?");
    if (
      sqliteRow(this.database.prepare("PRAGMA user_version").get())?.user_version !==
        storageSchemaVersion ||
      sqliteRow(metadata.get("project_id"))?.value !== this.projectId ||
      sqliteRow(metadata.get("storage_schema_version"))?.value !== String(storageSchemaVersion)
    )
      throw new EventStoreError("integrity_failed", "The event store binding changed.");
    const quickCheck = sqliteRow(this.database.prepare("PRAGMA quick_check;").get())?.quick_check;
    if (quickCheck !== "ok") {
      throw new EventStoreError(
        "integrity_failed",
        `SQLite quick_check failed: ${String(quickCheck)}`,
      );
    }
    const foreignKeyViolation = sqliteRow(this.database.prepare("PRAGMA foreign_key_check;").get());
    if (foreignKeyViolation !== undefined) {
      throw new EventStoreError("integrity_failed", "The SQLite foreign-key check failed.");
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
