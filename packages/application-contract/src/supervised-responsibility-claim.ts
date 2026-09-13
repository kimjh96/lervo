import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** One exact lease acquisition or expired-lease reassignment, separate from provider dispatch. */
export interface SupervisedResponsibilityClaimV1 {
  schemaVersion: 1;
  kind: "work.responsibility_claim";
  responsibility: WorkResponsibilityV1;
  expectedAssignmentHash: string;
  provider: "codex" | "claude";
  leaseDurationMs: number;
  rationaleArtifactHash: string;
}
