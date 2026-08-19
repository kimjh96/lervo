export type ConversationContractErrorCode =
  | "invalid_adapter_descriptor"
  | "invalid_conversation_event"
  | "invalid_participation_policy"
  | "invalid_participation_decision"
  | "invalid_outbound_message"
  | "invalid_delivery_receipt";

export class ConversationContractError extends Error {
  constructor(
    readonly code: ConversationContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationContractError";
  }
}
