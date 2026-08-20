export type ConversationPlatformSQLiteErrorCode =
  | "closed"
  | "conflicting_binding"
  | "integrity_failed"
  | "mapping_not_found"
  | "write_failed";

export class ConversationPlatformSQLiteError extends Error {
  constructor(
    readonly code: ConversationPlatformSQLiteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationPlatformSQLiteError";
  }
}
