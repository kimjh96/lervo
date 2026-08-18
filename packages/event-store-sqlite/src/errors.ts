export type EventStoreErrorCode =
  | "closed"
  | "event_id_conflict"
  | "integrity_failed"
  | "invalid_event"
  | "nested_transaction"
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
