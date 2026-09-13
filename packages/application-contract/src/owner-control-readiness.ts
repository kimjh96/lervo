/** Readiness for a bounded repository-owner control effect, independent of a worker lease. */
export interface OwnerControlReadinessV1 {
  schemaVersion: 1;
  kind: "work.owner_control.readiness";
  planHash: string;
  sourceRevisionDigest: string;
  ownerAgentId: string;
  effectContract:
    | "work.artifact_review.v1"
    | "work.goal_completion.v1"
    | "work.result_delivery.v1"
    | "work.result_delivery.v2"
    | "work.owner_reasoning.v1"
    | "work.workspace_preparation.v1"
    | "work.scoped_handoff.v1"
    | "work.scoped_handoff_acceptance.v1"
    | "work.owner_attention.v1"
    | "work.assignment_completion.v1"
    | "work.assignment_completion.v2"
    | "work.assignment_completion.v3";
  observedAt: string;
  validUntil: string;
  status: "ready" | "blocked";
  reasonCodes: string[];
}
