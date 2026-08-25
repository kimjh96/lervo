export type SyncWorkerErrorCode = "invalid_worker_configuration" | "outbox_update_failed";

export class SyncWorkerError extends Error {
  readonly code: SyncWorkerErrorCode;

  constructor(code: SyncWorkerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SyncWorkerError";
    this.code = code;
  }
}
