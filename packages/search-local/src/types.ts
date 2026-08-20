export type SearchLocalErrorCode =
  | "candidate_review_not_found"
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
  | "evaluation_comparison_not_found"
  | "engine_activation_conflict"
  | "engine_activation_not_found"
  | "engine_policy_invalid"
  | "engine_policy_not_found"
  | "engine_policy_read_failed"
  | "engine_policy_write_failed"
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
