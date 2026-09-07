export class LiveTriggerSQLiteError extends Error {
  constructor(
    readonly code: "capacity_exhausted" | "closed" | "integrity_failed" | "write_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveTriggerSQLiteError";
  }
}
