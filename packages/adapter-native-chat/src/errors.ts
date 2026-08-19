export type NativeChatAdapterErrorCode =
  | "invalid_native_chat_configuration"
  | "invalid_native_chat_event"
  | "unsupported_native_chat_capability"
  | "native_chat_delivery_failed";

export class NativeChatAdapterError extends Error {
  constructor(
    readonly code: NativeChatAdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NativeChatAdapterError";
  }
}
