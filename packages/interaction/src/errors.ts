export type InteractionErrorCode =
  | "invalid_interaction_request"
  | "interaction_store_failed"
  | "response_generation_failed"
  | "publication_verification_failed"
  | "adapter_delivery_failed"
  | "invalid_delivery_receipt";

export class InteractionError extends Error {
  constructor(
    readonly code: InteractionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InteractionError";
  }
}
