import type {
  DeliberationPolicy,
  RoleEvaluationBundle,
  RoleEvaluationCheckResult,
  RoleProfile,
} from "@lervo/schemas";

export interface RoleDefinition {
  profile: RoleProfile;
  evaluation: RoleEvaluationBundle;
}

export interface RoleContractCoordinate {
  roleId: string;
  version: string;
  contractHash: string;
}

export interface ResolvedRoleContract extends RoleContractCoordinate {
  schemaVersion: 1;
  sourceKind: "built_in" | "repository";
  sourcePath: string | null;
  extends: RoleContractCoordinate[];
  definition: RoleDefinition;
}

export type RoleEvaluationObservation = Omit<RoleEvaluationCheckResult, "method">;

export type RoleProviderSelection = DeliberationPolicy["participants"][number]["providerSelection"];

export class RoleContractError extends Error {
  constructor(
    readonly code:
      | "evaluation_bundle_invalid"
      | "evaluation_result_invalid"
      | "high_risk_workflow_invalid"
      | "role_built_in"
      | "role_contract_stale"
      | "role_exists"
      | "role_extended"
      | "role_name_conflict"
      | "role_not_found"
      | "role_publication_blocked"
      | "role_profile_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RoleContractError";
  }
}
