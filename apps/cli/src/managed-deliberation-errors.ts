export class ManagedDeliberationError extends Error {
  constructor(
    readonly code:
      | "deliberation_cleanup_failed"
      | "deliberation_project_mismatch"
      | "deliberation_request_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedDeliberationError";
  }
}
