import type { WorkResponsibilityV1 } from "./work-responsibility.js";

export interface SupervisedAssignmentCompletionV1 {
  schemaVersion: 1;
  kind: "work.assignment_completion";
  responsibility: WorkResponsibilityV1;
  expectedAssignmentHash: string;
  writingArtifactHash: string;
  reasoningPlanHash: string;
  reasoningResultHash: string;
  preparedAt: string;
  rationaleArtifactHash: string;
}

export interface SupervisedAssignmentCompletionV2 extends Omit<
  SupervisedAssignmentCompletionV1,
  "schemaVersion"
> {
  schemaVersion: 2;
  roleEvaluationArtifactHash: string;
}

export type SupervisedAssignmentCompletion =
  SupervisedAssignmentCompletionV1 | SupervisedAssignmentCompletionV2;
