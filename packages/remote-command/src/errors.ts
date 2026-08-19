export type RemoteCommandRuntimeErrorCode =
  | "invalid_runtime_configuration"
  | "invalid_command"
  | "trust_store_failed"
  | "unknown_signer"
  | "invalid_signature"
  | "signer_scope_denied"
  | "target_mismatch"
  | "command_not_yet_valid"
  | "command_expired"
  | "command_lifetime_exceeded"
  | "idempotency_conflict"
  | "nonce_replay"
  | "command_in_progress"
  | "policy_denied"
  | "approval_required"
  | "policy_evaluation_failed"
  | "replay_store_failed";

export class RemoteCommandRuntimeError extends Error {
  readonly code: RemoteCommandRuntimeErrorCode;

  constructor(code: RemoteCommandRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RemoteCommandRuntimeError";
    this.code = code;
  }
}
