export type PolicyRuntimeErrorCode =
  | "invalid_runtime_configuration"
  | "hub_unavailable"
  | "transport_authentication_failed"
  | "invalid_policy_bundle"
  | "unknown_policy_signer"
  | "policy_signer_scope_denied"
  | "policy_signer_purpose_denied"
  | "invalid_policy_signature"
  | "policy_store_failed"
  | "policy_evaluation_failed";

export class PolicyRuntimeError extends Error {
  constructor(readonly code: PolicyRuntimeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PolicyRuntimeError";
  }
}
