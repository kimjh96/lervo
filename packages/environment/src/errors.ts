export type EnvironmentErrorCode =
  | "invalid_environment_source"
  | "invalid_environment_target"
  | "invalid_environment_policy"
  | "environment_source_not_found"
  | "environment_target_not_found"
  | "environment_adapter_not_found"
  | "environment_adapter_mismatch"
  | "invalid_environment_observation";

export class EnvironmentError extends Error {
  constructor(
    readonly code: EnvironmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EnvironmentError";
  }
}
