export type InteractionSQLiteErrorCode =
  "closed" | "capacity_exceeded" | "integrity_failed" | "lease_mismatch" | "write_failed";

export class InteractionSQLiteError extends Error {
  constructor(
    readonly code: InteractionSQLiteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InteractionSQLiteError";
  }
}
