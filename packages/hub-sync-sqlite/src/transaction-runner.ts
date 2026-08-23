import { type DatabaseSync } from "node:sqlite";

import { HubSyncStoreError, type HubSyncStoreErrorCode } from "./errors.js";

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function sqliteFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("ERR_SQLITE")
  );
}

export class SQLiteTransactionRunner {
  private active = false;

  constructor(private readonly database: DatabaseSync) {}

  read<T>(work: () => T): T {
    return this.run({
      begin: "BEGIN;",
      failureCode: "read_failed",
      failureMessage: "Could not complete the Hub sync SQLite read snapshot.",
      work,
    });
  }

  write<T>(work: () => T): T {
    return this.run({
      begin: "BEGIN IMMEDIATE;",
      failureCode: "write_failed",
      failureMessage: "Could not store the Hub sync SQLite transaction durably.",
      work,
    });
  }

  private run<T>(input: {
    begin: string;
    failureCode: Extract<HubSyncStoreErrorCode, "read_failed" | "write_failed">;
    failureMessage: string;
    work: () => T;
  }): T {
    if (this.active) {
      throw new HubSyncStoreError(
        "nested_transaction",
        "Nested Hub sync SQLite transactions are not supported.",
      );
    }
    try {
      this.database.exec(input.begin);
    } catch (error) {
      throw new HubSyncStoreError(input.failureCode, input.failureMessage, { cause: error });
    }
    this.active = true;
    try {
      const result = input.work();
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new HubSyncStoreError(
          "transaction_async",
          "The Hub sync SQLite transaction callback must be synchronous.",
        );
      }
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new HubSyncStoreError(
          input.failureCode,
          "Both the Hub sync SQLite transaction and rollback failed.",
          { cause: new AggregateError([error, rollbackError]) },
        );
      }
      if (sqliteFailure(error)) {
        throw new HubSyncStoreError(input.failureCode, input.failureMessage, { cause: error });
      }
      throw error;
    } finally {
      this.active = false;
    }
  }
}
