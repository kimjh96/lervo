export type PolicySQLiteErrorCode =
  "closed" | "integrity_failed" | "stale_policy" | "write_failed" | "capacity_exceeded";

export class PolicySQLiteError extends Error {
  constructor(
    readonly code: PolicySQLiteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PolicySQLiteError";
  }
}
