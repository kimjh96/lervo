/** An owner's explicit verdict over one exact returned result; never inferred from verification. */
export interface SupervisedArtifactReviewV1 {
  schemaVersion: 1;
  kind: "work.artifact_review";
  assignmentId: string;
  assignmentRevision: number;
  responsibilityArtifactHash: string;
  terminalEventId: string;
  reviewerAgentId: string;
  acceptanceHash: string;
  artifactHashes: string[];
  verificationEventIds: string[];
  verdict: "accepted" | "rework" | "blocked";
  rationaleArtifactHash: string;
}
