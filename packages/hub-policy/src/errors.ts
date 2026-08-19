export type HubPolicyErrorCode =
  | "invalid_policy_request"
  | "policy_registration_required"
  | "policy_identity_mismatch"
  | "policy_snapshot_conflict"
  | "policy_command_not_found"
  | "policy_approval_not_found"
  | "policy_capacity_exceeded";

export class HubPolicyError extends Error {
  constructor(
    readonly code: HubPolicyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubPolicyError";
  }
}
