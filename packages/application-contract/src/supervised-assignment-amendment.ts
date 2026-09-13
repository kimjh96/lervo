import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** One current amendment; predecessor bytes and duties remain in canonical CAS and events. */
export interface AssignmentAmendmentCoordinateV1 {
  predecessorAssignmentHash: string;
  predecessorResponsibilityHash: string;
  successorResponsibilityHash: string;
}

export interface SupervisedAssignmentAmendmentV1 {
  schemaVersion: 1;
  kind: "work.assignment_amendment";
  responsibility: WorkResponsibilityV1;
  expectedAssignmentHash: string;
  predecessorBindingHash: string;
  provider: "codex" | "claude";
  rationaleArtifactHash: string;
}
