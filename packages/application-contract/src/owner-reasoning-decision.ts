/** Model output is a proposal. Concrete effect admission owns all authority and mutation. */
export interface OwnerReasoningDecisionV1 {
  schemaVersion: 1;
  operation:
    | "allocate_existing"
    | "prepare_completion"
    | "prepare_publication"
    | "review_artifacts"
    | "complete_workstream"
    | "request_rework"
    | "retry_attempt"
    | "revise_responsibility"
    | "request_team_support"
    | "accept_team_support"
    | "hire_worker"
    | "escalate";
  rationale: string;
  details: string;
}
