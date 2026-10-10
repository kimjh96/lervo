export type CasErrorCode =
  | "capacity_exceeded"
  | "corrupt_object"
  | "invalid_uri"
  | "not_found"
  | "unsafe_path"
  | "read_only";

export class CasError extends Error {
  constructor(
    readonly code: CasErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CasError";
  }
}
