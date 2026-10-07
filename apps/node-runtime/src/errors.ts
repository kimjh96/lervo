export type NodeRuntimeErrorCode =
  | "invalid_arguments"
  | "invalid_config"
  | "configured_executable_unavailable"
  | "runtime_dependency_unavailable"
  | "health_snapshot_invalid"
  | "unsafe_runtime_file"
  | "project_invalid"
  | "startup_failed"
  | "sync_runtime_failed"
  | "token_reload_failed"
  | "organization_credential_delivery_failed"
  | "runtime_material_reload_failed"
  | "shutdown_failed"
  | "sqlite_row_invalid";

export class NodeRuntimeError extends Error {
  constructor(
    readonly code: NodeRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NodeRuntimeError";
  }
}
