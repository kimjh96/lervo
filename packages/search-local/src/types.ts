export type SearchLocalErrorCode =
  | "corpus_limit_exceeded"
  | "corpus_read_failed"
  | "evaluation_case_invalid"
  | "evaluation_case_limit_exceeded"
  | "evaluation_case_read_failed"
  | "evaluation_case_write_failed"
  | "evaluation_bundle_invalid"
  | "evaluation_bundle_limit_exceeded"
  | "evaluation_bundle_read_failed"
  | "evaluation_bundle_write_failed"
  | "evaluation_candidate_failed"
  | "evaluation_comparison_not_ready"
  | "evaluation_not_found"
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
