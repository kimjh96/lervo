export type CasErrorCode =
  | "capacity_exceeded"
  | "corrupt_object"
  | "invalid_uri"
  | "not_found"
  /** ADR-0658: retention removed the object and left a tombstone in its place. */
  | "pruned"
  | "unsafe_path"
  | "read_only";

export class CasError extends Error {
  constructor(
    readonly code: CasErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CasError";
  }
}
