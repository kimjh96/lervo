export type EventWriterActivationFailureCode =
  | "event_writer_activation_blocked"
  | "event_writer_coordinate_invalid"
  | "event_writer_evidence_invalid"
  | "reader_inventory_revalidation_required"
  | "event_writer_plan_stale"
  | "event_writer_recovery_required";

export class EventWriterActivationError extends Error {
  constructor(
    readonly code: EventWriterActivationFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventWriterActivationError";
  }
}

export function failEventWriterActivation(
  code: EventWriterActivationFailureCode,
  message: string,
): never {
  throw new EventWriterActivationError(code, message);
}
