export type SearchLocalErrorCode =
  | "corpus_limit_exceeded"
  | "corpus_read_failed"
  | "observation_conflict"
  | "observation_invalid"
  | "observation_limit_exceeded"
  | "observation_read_failed"
  | "observation_write_failed";

export class SearchLocalError extends Error {
  constructor(readonly code: SearchLocalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchLocalError";
  }
}
