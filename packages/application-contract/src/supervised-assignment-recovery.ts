import type { WorkResponsibilityV1 } from "./work-responsibility.js";

/** One current recovery coordinate; earlier attempts remain in canonical events and CAS. */
export interface AssignmentRecoveryCoordinateV1 {
  kind: "rework" | "retry";
  predecessorAssignmentHash: string;
  responsibilityHash: string;
  sourceRunId: string;
  terminalEventId: string;
  reviewEventId: string | null;
  attemptNumber: number;
  predecessorLeaseGeneration: number;
}

export interface SupervisedAssignmentRecoveryV1 {
  schemaVersion: 1;
  kind: "work.assignment_recovery";
  responsibility: WorkResponsibilityV1;
  recovery: AssignmentRecoveryCoordinateV1;
  provider: "codex" | "claude";
  rationaleArtifactHash: string;
}

/** A rejected returned run can release its exact lease before accepting any result. */
export interface SupervisedAssignmentRecoveryV2 extends Omit<
  SupervisedAssignmentRecoveryV1,
  "schemaVersion"
> {
  schemaVersion: 2;
  settledLeaseId: string;
}

export type SupervisedAssignmentRecovery =
  SupervisedAssignmentRecoveryV1 | SupervisedAssignmentRecoveryV2;
