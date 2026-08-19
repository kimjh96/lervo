export type RemoteCommandContractErrorCode =
  | "invalid_command"
  | "invalid_signature_envelope"
  | "invalid_execution_receipt";

export class RemoteCommandContractError extends Error {
  readonly code: RemoteCommandContractErrorCode;

  constructor(code: RemoteCommandContractErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RemoteCommandContractError";
    this.code = code;
  }
}
