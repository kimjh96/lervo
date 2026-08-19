export type PolicyContractErrorCode =
  | "invalid_policy_snapshot"
  | "invalid_policy_approval"
  | "invalid_policy_revocation"
  | "invalid_policy_signature";

export class PolicyContractError extends Error {
  constructor(
    readonly code: PolicyContractErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PolicyContractError";
  }
}
