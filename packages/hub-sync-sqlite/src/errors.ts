export type HubSyncStoreErrorCode =
  | "closed"
  | "integrity_failed"
  | "nested_transaction"
  | "remote_command_ack_invalid"
  | "remote_command_conflict"
  | "remote_command_identity_mismatch"
  | "remote_command_registration_required"
  | "read_failed"
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
