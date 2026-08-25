export type RemoteCommandSQLiteErrorCode =
  "capacity_exceeded" | "closed" | "integrity_failed" | "write_failed";

export class RemoteCommandSQLiteError extends Error {
  readonly code: RemoteCommandSQLiteErrorCode;

  constructor(code: RemoteCommandSQLiteErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RemoteCommandSQLiteError";
    this.code = code;
  }
}
