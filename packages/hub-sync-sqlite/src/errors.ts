export type HubSyncStoreErrorCode =
  | "closed"
  | "integrity_failed"
  | "nested_transaction"
  | "state_conflict"
  | "transaction_async"
  | "write_failed";

export class HubSyncStoreError extends Error {
  readonly code: HubSyncStoreErrorCode;

  constructor(code: HubSyncStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HubSyncStoreError";
    this.code = code;
  }
}
