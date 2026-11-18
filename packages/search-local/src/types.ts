export type SearchLocalErrorCode =
  | "corpus_limit_exceeded"
  | "corpus_read_failed"
  | "engine_selection_unavailable"
  | "retrieval_plan_bundle_invalid"
  | "retrieval_plan_bundle_not_found"
  | "retrieval_plan_bundle_read_failed"
  | "retrieval_plan_bundle_write_failed"
  | "retrieval_plan_activation_conflict"
  | "retrieval_plan_activation_not_found"
  | "retrieval_plan_selection_unavailable"
  | "observation_conflict"
  | "observation_invalid"
  | "observation_limit_exceeded"
  | "observation_read_failed"
  | "observation_write_failed";

export class SearchLocalError extends Error {
  constructor(
    readonly code: SearchLocalErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SearchLocalError";
  }
}
