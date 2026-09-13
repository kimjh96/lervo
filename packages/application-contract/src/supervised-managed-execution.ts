import type { AssignmentRecoveryCoordinateV1 } from "./supervised-assignment-recovery.js";
import type { WorkResponsibilityV1 } from "./work-responsibility.js";

export interface SupervisedManagedExecutionV1 {
  schemaVersion: 1;
  kind: "work.managed_execution";
  responsibility: WorkResponsibilityV1;
  leaseId: string;
  provider: "codex" | "claude";
  instructions: string;
  risk: "low" | "medium" | "high";
  reservedTokens: number;
}

export interface SupervisedManagedExecutionV2 extends Omit<
  SupervisedManagedExecutionV1,
  "schemaVersion"
> {
  schemaVersion: 2;
  recovery: AssignmentRecoveryCoordinateV1;
  workId: string;
}

export type SupervisedManagedExecution =
  SupervisedManagedExecutionV1 | SupervisedManagedExecutionV2;
