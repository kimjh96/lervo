export type EventStoreErrorCode =
  | "closed"
  | "event_id_conflict"
  | "integrity_failed"
  | "invalid_outbox_request"
  | "invalid_event"
  | "nested_transaction"
  | "outbox_lease_conflict"
  | "outbox_not_found"
  | "project_mismatch"
  | "transaction_async";

export class EventStoreError extends Error {
  constructor(
    readonly code: EventStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EventStoreError";
  }
}
