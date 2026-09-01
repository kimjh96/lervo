export type SyncContractErrorCode =
  | "event_chain_conflict"
  | "event_schema_unsupported"
  | "invalid_acknowledgement"
  | "invalid_event_batch"
  | "invalid_registration"
  | "invalid_sync_state"
  | "project_sync_disabled"
  | "registration_identity_conflict"
  | "registration_required";

export class SyncContractError extends Error {
  constructor(
    readonly code: SyncContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SyncContractError";
  }
}
