export type HubTraceErrorCode =
  | "invalid_query"
  | "project_not_found"
  | "run_not_found"
  | "source_inconsistent";

export class HubTraceError extends Error {
  readonly code: HubTraceErrorCode;

  constructor(code: HubTraceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HubTraceError";
    this.code = code;
  }
}
