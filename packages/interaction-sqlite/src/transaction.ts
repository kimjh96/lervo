import type { DatabaseSync } from "node:sqlite";

import { InteractionSQLiteError } from "./errors.js";

export class InteractionSQLiteTransactionRunner {
  constructor(private readonly database: DatabaseSync) {}

  write<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK;");
      } catch (rollbackError) {
        throw new InteractionSQLiteError("write_failed", "The Interaction transaction rollback failed.", {
          cause: new AggregateError([error, rollbackError]),
        });
      }
      throw error;
    }
  }
}
