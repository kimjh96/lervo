import {
  claimAssignment,
  type AgentWorkforceError,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";

import { mutateWorkforceState } from "./workforce-mutation.js";

export interface ClaimUnattendedAssignmentInput {
  repositoryRoot: string;
  assignmentId: string;
  expectedRevision: number;
  agentId: string;
  sessionId: string;
  leaseDurationMs: number;
  now: Date;
}

export type ClaimUnattendedAssignment = (
  input: ClaimUnattendedAssignmentInput,
) => Promise<WorkforceAssignment>;

export const claimUnattendedAssignment: ClaimUnattendedAssignment = (input) =>
  mutateWorkforceState(input.repositoryRoot, (recordEvent) =>
    claimAssignment({
      ...input,
      recordEvent,
    }),
  );

export function isRecoverableUnattendedClaimRace(error: unknown): boolean {
  const code = (error as AgentWorkforceError | null)?.code;
  return [
    "agent_state_conflict",
    "assignment_dependency_blocked",
    "assignment_lease_conflict",
    "assignment_path_conflict",
    "workforce_busy",
  ].includes(code ?? "");
}
