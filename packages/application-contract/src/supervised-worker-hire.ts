import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** The requirement is planning evidence, not an installed responsibility or assignment. */
export interface SupervisedWorkerHireV1 {
  schemaVersion: 1;
  kind: "work.worker_hire";
  requirement: WorkResponsibilityV1;
  displayName: string;
  provider: "codex" | "claude";
  expectedAgentsHash: string;
  rationaleArtifactHash: string;
}
