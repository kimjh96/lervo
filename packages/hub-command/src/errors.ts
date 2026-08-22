export type HubCommandErrorCode =
  | "invalid_request"
  | "idempotency_conflict"
  | "artifact_store_failed"
  | "artifact_integrity_failed";

export class HubCommandError extends Error {
  constructor(
    readonly code: HubCommandErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubCommandError";
  }
}
