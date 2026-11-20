import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

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
  type OutboxSummary,
  type OutboxTransaction,
  type ReportReader,
  type ReportWriter,
  type PurgeAcknowledgedOutboxRequest,
  type PurgeAcknowledgedOutboxResult,
  type RescheduleOutboxRequest,
  type RescheduleOutboxResult,
} from "@lervo/storage-contract";

import {
  configureCheckpointPolicy,
  configureNewReportDatabase,
  validateCheckpointOptions,
  type CheckpointOptions,
} from "./checkpoint-policy.js";
import { recordCommitTime } from "./change-channel-commit-times.js";
import { notifyEventStoreChange } from "./change-channel-notify.js";
import { ensureDatabasePath } from "./database-lifecycle.js";
import { bindDatabaseMetadata } from "./database-metadata.js";
import { EventStoreError } from "./errors.js";
import { SQLiteEventRepository } from "./event-repository.js";
import { configureDatabase, migrateDatabase } from "./migrations.js";
import { SQLiteOutboxRepository } from "./outbox.js";
import { openReadOnlyEventDatabase } from "./read-only-database.js";
import { protectReportFiles } from "./report-file-permissions.js";
import { SQLiteReportRepository } from "./report-repository.js";
import { migrateReportStorage, readStorageFormat, verifyReportSchema } from "./report-schema.js";
import { createReportWriter } from "./report-writer.js";
import { sqliteRow } from "./sqlite-row.js";
import { preparedStatement } from "./statement-cache.js";

export interface OpenEventStoreOptions extends CheckpointOptions {
  path: string;
  projectId: ProjectManifest["projectId"];
  writableEventSchemaVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** sqlite_v1 permits a transition; existing_sqlite_v1 selects only an already migrated store. */
  reportStorage?: "sqlite_v1" | "existing_sqlite_v1";
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
  private readonly storageVersion: 3 | 4;
  readonly reports: ReportReader;
  readonly reportWriter?: ReportWriter;

  private constructor(
    path: string,
    projectId: string,
    private readonly database: DatabaseSync,
    writableEventSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    private readonly readOnly = false,
    reportWriting = false,
  ) {
    this.path = path;
    this.projectId = projectId;
    this.events = new SQLiteEventRepository(database, projectId, writableEventSchemaVersion);
    this.outbox = new SQLiteOutboxRepository(database);
    this.storageVersion = readStorageFormat(database);
    const reports =
      this.storageVersion === 4
        ? new SQLiteReportRepository(
            database,
            () => this.assertOpen(),
            () => {
              throw new EventStoreError("read_only", "The report reader cannot insert reports.");
            },
          )
        : undefined;
    if (reportWriting && this.storageVersion === 4) {
      this.reportWriter = createReportWriter(database, {
        assertAvailable: () => {
          this.assertOpen();
          if (this.transactionActive)
            throw new EventStoreError(
              "nested_transaction",
              "A report writer must own its transaction.",
            );
        },
        transact: (work) => this.transact(work),
      });
    }
    this.reports = Object.freeze({
      getReport: (hash: string) => {
        this.assertOpen();
        if (readStorageFormat(this.database) !== this.storageVersion)
          throw new EventStoreError("integrity_failed", "The report storage format changed.");
        return reports?.get(hash) ?? null;
      },
    });
  }

  static async open(options: OpenEventStoreOptions): Promise<SQLiteEventStore> {
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(options.writableEventSchemaVersion ?? 1)) {
      throw new EventStoreError(
        "event_schema_unsupported",
        "The writer activation version is unsupported.",
      );
    }
    if (
      options.reportStorage !== undefined &&
      (!["sqlite_v1", "existing_sqlite_v1"].includes(options.reportStorage) ||
        (options.writableEventSchemaVersion ?? 1) < 6)
    )
      throw new EventStoreError(
        "event_schema_unsupported",
        "Report storage requires an explicit version-6 format selection.",
      );
    validateCheckpointOptions(options);
    const path = await ensureDatabasePath(options.path);
    const database = openSqliteDatabase(path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      if (
        options.reportStorage === "sqlite_v1" ||
        sqliteRow(database.prepare("PRAGMA user_version").get())?.user_version === 4
      )
        await protectReportFiles(path, "secure");
      if (options.reportStorage === "sqlite_v1") configureNewReportDatabase(database);
      configureDatabase(database);
      database.exec("BEGIN IMMEDIATE;");
      try {
        migrateDatabase(database, "nested");
        if (options.reportStorage === "sqlite_v1") migrateReportStorage(database);
        const storageVersion = readStorageFormat(database);
        if (storageVersion === 4) verifyReportSchema(database);
        bindDatabaseMetadata(database, options.projectId, "nested", storageVersion);
        configureCheckpointPolicy(
          database,
          options,
          options.reportStorage !== undefined && storageVersion === 4,
        );
        database.exec("COMMIT;");
      } catch (error) {
        database.exec("ROLLBACK;");
        throw error;
      }
      const store = new SQLiteEventStore(
        path,
        options.projectId,
        database,
        options.writableEventSchemaVersion ?? 1,
        false,
        options.reportStorage !== undefined,
      );
      store.verifyBinding();
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
      store.verifyBinding();
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
    let committed = false;
    // ADR-0602: the head before the work, so the commit's own sequence range is known after it.
    const headBefore = this.events.latestSeq();
    try {
      // Every write first confirms that this handle still owns the expected store.
      this.verifyBinding();
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
      // ADR-0602: the commit's time, recorded while the write lock still serializes writers.
      const headAfter = this.events.latestSeq();
      if (headAfter !== null && headAfter !== headBefore)
        recordCommitTime(this.path, { from: (headBefore ?? 0) + 1, to: headAfter });
      this.database.exec("COMMIT;");
      committed = true;
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    } finally {
      this.transactionActive = false;
      // ADR-0602: subscribers in any process wake on the commit, never on a timer.
      if (committed) notifyEventStoreChange(this.path);
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

  outboxSummary(destinationId: string): OutboxSummary {
    this.assertOpen();
    return this.outbox.summary(destinationId);
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

  latestSeq() {
    this.assertOpen();
    return this.events.latestSeq();
  }

  latestHash() {
    this.assertOpen();
    return this.events.latestHash();
  }

  latestHashExcluding(types: readonly string[]) {
    this.assertOpen();
    return this.events.latestHashExcluding(types);
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

  /**
   * Confirms the opened file is this project's store in the expected format. It does not
   * scan history: returned rows are hash-checked when read and appends check their predecessor.
   */
  private verifyBinding(): void {
    this.assertOpen();
    const metadata = preparedStatement(this.database, "SELECT value FROM store_meta WHERE key = ?");
    if (
      sqliteRow(preparedStatement(this.database, "PRAGMA user_version").get())?.user_version !==
        this.storageVersion ||
      sqliteRow(metadata.get("project_id"))?.value !== this.projectId ||
      sqliteRow(metadata.get("storage_schema_version"))?.value !== String(this.storageVersion)
    )
      throw new EventStoreError("integrity_failed", "The event store binding changed.");
    if (this.storageVersion === 4) verifyReportSchema(this.database);
  }

  /** Explicit complete verification of SQLite structure, outbox rows and the full event chain. */
  verifyIntegrity(): EventChainReport {
    this.verifyBinding();
    const quickCheck = sqliteRow(
      preparedStatement(this.database, "PRAGMA quick_check;").get(),
    )?.quick_check;
    if (quickCheck !== "ok") {
      throw new EventStoreError(
        "integrity_failed",
        `SQLite quick_check failed: ${String(quickCheck)}`,
      );
    }
    const foreignKeyViolation = sqliteRow(
      preparedStatement(this.database, "PRAGMA foreign_key_check;").get(),
    );
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
