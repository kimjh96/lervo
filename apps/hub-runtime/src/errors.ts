export type HubRuntimeErrorCode =
  | "invalid_arguments"
  | "invalid_config"
  | "unsafe_runtime_file"
  | "startup_failed"
  | "listen_failed"
  | "shutdown_failed";

export class HubRuntimeError extends Error {
  constructor(
    readonly code: HubRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HubRuntimeError";
  }
}
