export type OrganizationDeploymentErrorCode =
  | "invalid_organization_policy"
  | "invalid_organization_policy_signature"
  | "organization_authority_denied"
  | "invalid_credential_grant"
  | "invalid_credential_revocation"
  | "credential_not_active"
  | "credential_revoked"
  | "credential_source_failed"
  | "credential_material_invalid"
  | "credential_activation_failed"
  | "invalid_node_enrollment"
  | "invalid_fleet_rollout_plan"
  | "invalid_fleet_wave_observation"
  | "fleet_wave_gate_not_satisfied"
  | "invalid_fleet_rollout_approval"
  | "invalid_node_rollout_execution_plan"
  | "invalid_node_rollout_execution_receipt"
  | "node_rollout_execution_failed"
  | "invalid_node_rollout_delivery"
  | "invalid_node_rollout_delivery_signature"
  | "invalid_node_rollout_delivery_receipt"
  | "node_rollout_delivery_signer_denied"
  | "node_rollout_delivery_trust_failed"
  | "node_rollout_delivery_not_current"
  | "node_rollout_delivery_replay_rejected"
  | "node_rollout_delivery_in_progress"
  | "node_rollout_delivery_persistence_failed"
  | "invalid_node_rollout_recovery_receipt"
  | "node_rollout_recovery_unavailable"
  | "node_rollout_recovery_failed"
  | "invalid_node_rollout_rollback_plan"
  | "invalid_node_rollout_rollback_receipt"
  | "node_rollout_rollback_failed"
  | "invalid_node_rollback_delivery"
  | "invalid_node_rollback_delivery_signature"
  | "invalid_node_rollback_delivery_receipt"
  | "node_rollback_delivery_not_current"
  | "node_rollback_delivery_replay_rejected"
  | "node_rollback_delivery_in_progress"
  | "node_rollback_delivery_persistence_failed"
  | "invalid_node_rollback_recovery_receipt"
  | "node_rollback_recovery_unavailable"
  | "node_rollback_recovery_failed";

export class OrganizationDeploymentError extends Error {
  constructor(
    readonly code: OrganizationDeploymentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OrganizationDeploymentError";
  }
}
