import { DatabaseSync } from "node:sqlite";

import {
  type HubProjectCoordinate,
  type HubSyncIntegrityReport,
  type HubSyncReadView,
  type HubSyncStore,
  type HubSyncTransaction,
} from "@lervo/hub-sync";

import { ensureDatabasePath } from "./database-lifecycle.js";
import { HubSyncStoreError } from "./errors.js";
import { configureDatabase, migrateDatabase } from "./migrations.js";
import { HubSyncSQLiteRepository } from "./repository.js";
import { SQLiteTransactionRunner } from "./transaction-runner.js";

export class HubSyncSQLiteStore implements HubSyncStore {
  readonly path: string;
  private closed = false;
  private readonly repository: HubSyncSQLiteRepository;
  private readonly transactionRunner: SQLiteTransactionRunner;

  private constructor(path: string, private readonly database: DatabaseSync) {
    this.path = path;
    this.repository = new HubSyncSQLiteRepository(database);
    this.transactionRunner = new SQLiteTransactionRunner(database);
  }

  static async open(options: { path: string }): Promise<HubSyncSQLiteStore> {
    const path = await ensureDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureDatabase(database);
      migrateDatabase(database);
      const store = new HubSyncSQLiteStore(path, database);
      store.verifyIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HubSyncStoreError("closed", "닫힌 Hub sync SQLite store는 사용할 수 없습니다.");
    }
  }

  transact<T>(work: (transaction: HubSyncTransaction) => T): T {
    this.assertOpen();
    return this.transactionRunner.write(() => work({
      ...this.readView(),
      saveProject: (state) => this.repository.saveProject(state),
    }));
  }

  read<T>(work: (view: HubSyncReadView) => T): T {
    this.assertOpen();
    return this.transactionRunner.read(() => work(this.readView()));
  }

  private readView(): HubSyncReadView {
    return {
      loadProject: (coordinate) => this.repository.loadProject(coordinate),
      listProjectCoordinates: () => this.repository.listProjectCoordinates(),
    };
  }

  getProject(coordinate: HubProjectCoordinate) {
    this.assertOpen();
    return this.repository.loadProject(coordinate);
  }

  listProjectCoordinates(): HubProjectCoordinate[] {
    this.assertOpen();
    return this.repository.listProjectCoordinates();
  }

  verifyIntegrity(): HubSyncIntegrityReport {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite quick_check가 실패했습니다.");
    }
    if (this.database.prepare("PRAGMA foreign_key_check;").get() !== undefined) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite foreign key 검사가 실패했습니다.",
      );
    }
    const requiredTriggers = new Set([
      "hub_events_no_update",
      "hub_events_no_delete",
      "hub_projects_no_delete",
    ]);
    for (const row of this.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
    ).all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite append-only trigger가 누락되었습니다.",
      );
    }
    const coordinates = this.repository.listProjectCoordinates();
    let eventCount = 0;
    for (const coordinate of coordinates) {
      const state = this.repository.loadProject(coordinate);
      if (state === null) {
        throw new HubSyncStoreError(
          "integrity_failed",
          "Hub sync SQLite project index와 원본이 다릅니다.",
        );
      }
      eventCount += state.events.length;
    }
    return { valid: true, projectCount: coordinates.length, eventCount };
  }

  journalMode(): string {
    this.assertOpen();
    const mode = this.database.prepare("PRAGMA journal_mode;").get()?.journal_mode;
    if (typeof mode !== "string") {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite journal mode를 읽을 수 없습니다.");
    }
    return mode;
  }

  close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
