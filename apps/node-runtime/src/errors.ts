export type NodeRuntimeErrorCode =
  | "invalid_arguments"
  | "invalid_config"
  | "unsafe_runtime_file"
  | "project_invalid"
  | "startup_failed"
  | "sync_runtime_failed"
  | "token_reload_failed"
  | "runtime_material_reload_failed"
  | "shutdown_failed";

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
