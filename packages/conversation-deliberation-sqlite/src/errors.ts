export class ConversationDeliberationSQLiteError extends Error {
  constructor(
    readonly code:
      | "capacity_exceeded"
      | "closed"
      | "deliberation_request_conflict"
      | "integrity_failed"
      | "lease_mismatch"
      | "write_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationDeliberationSQLiteError";
  }
}
