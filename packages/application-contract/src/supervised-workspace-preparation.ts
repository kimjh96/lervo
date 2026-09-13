import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** One exact host provision plan under an existing responsibility and lease. */
export interface SupervisedWorkspacePreparationV1 {
  schemaVersion: 1;
  kind: "work.workspace_preparation";
  responsibility: WorkResponsibilityV1;
  provisionPlanHash: string;
  provider: "codex" | "claude";
  rationaleArtifactHash: string;
}
