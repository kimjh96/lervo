/** Explicit owner acceptance of the complete current goal and its contextual result. */
export interface SupervisedGoalCompletionV1 {
  schemaVersion: 1;
  kind: "work.goal_completion";
  workstreamId: string;
  workstreamRevision: number;
  workstreamSnapshotHash: string;
  ownerAgentId: string;
  assignmentReviews: { assignmentId: string; assignmentRevision: number; reviewEventId: string }[];
  resultArtifactHash: string;
  rationaleArtifactHash: string;
  completedAt: string;
}
