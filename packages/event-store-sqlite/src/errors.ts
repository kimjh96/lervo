export type EventStoreErrorCode =
  | "closed"
  | "read_only"
  | "event_id_conflict"
  | "event_schema_unsupported"
  | "integrity_failed"
  | "invalid_outbox_request"
  | "invalid_event"
  | "invalid_report"
  | "report_corrupt"
  | "report_capacity_exceeded"
  | "nested_transaction"
  | "outbox_lease_conflict"
  | "outbox_not_found"
  | "project_mismatch"
  | "transaction_async";

export class EventStoreError extends Error {
  constructor(
    readonly code: EventStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventStoreError";
  }
}
