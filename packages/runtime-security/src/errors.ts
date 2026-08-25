export type RuntimeSecurityErrorCode = "unsafe_file" | "invalid_text" | "unsafe_database";

export class RuntimeSecurityError extends Error {
  constructor(
    readonly code: RuntimeSecurityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RuntimeSecurityError";
  }
}
