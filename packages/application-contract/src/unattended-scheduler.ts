import type { GovernedWorkReportV1 } from "./types.js";

export type UnattendedSchedulerProviderV1 = "codex" | "claude";

export interface UnattendedSchedulerAgentV1 {
  agentId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  provider: UnattendedSchedulerProviderV1 | "any";
  capabilityHash: string;
  skillIds: string[];
  capabilityIds: string[];
  responsibilityPaths: string[];
  status: "active" | "suspended" | "retired";
}

export interface UnattendedSchedulerAssignmentV1 {
  assignmentId: string;
  revision: number;
  workstreamId: string | null;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  expectedPaths: string[];
  assigneeAgentId: string | null;
  lease: { leaseId: string; sessionId: string } | null;
}

export interface UnattendedSchedulerSelectionInputV1 {
  schemaVersion: 1;
  schedulerSessionId: string;
  provider: UnattendedSchedulerProviderV1;
  eligibleAgentIds: string[];
  report: GovernedWorkReportV1;
  agents: UnattendedSchedulerAgentV1[];
  assignments: UnattendedSchedulerAssignmentV1[];
}

export type UnattendedSchedulerSelectionV1 =
  | {
      schemaVersion: 1;
      decisionId: string;
      graphHash: string;
      kind: "claim_assignment";
      reasonCode: "ready" | "lease_expired";
      assignmentId: string;
      expectedAssignmentRevision: number;
      agentId: string;
    }
  | {
      schemaVersion: 1;
      decisionId: string;
      graphHash: string;
      kind: "execute_assignment";
      reasonCode: "ready" | "attempt_failed";
      attemptKind: "start_attempt" | "retry_attempt";
      assignmentId: string;
      expectedAssignmentRevision: number;
      agentId: string;
      leaseId: string;
    }
  | {
      schemaVersion: 1;
      decisionId: string;
      graphHash: string;
      kind: "wait";
      reasonCode:
        "approval_pending" | "dependencies_incomplete" | "foreign_active_lease" | "no_assignments";
      assignmentId: string | null;
    }
  | {
      schemaVersion: 1;
      decisionId: string;
      graphHash: string;
      kind: "stop";
      reasonCode:
        | "cancellation_required"
        | "completion_reconciliation_required"
        | "governed_blocked"
        | "governed_escalation_required"
        | "governed_invalid"
        | "no_eligible_agent"
        | "work_complete";
      assignmentId: string | null;
      governedReasonCode: string | null;
    };

export type UnattendedSchedulerResultReasonV1 =
  | "claim_limit"
  | "consecutive_failure_limit"
  | "cycle_limit"
  | "governed_attention_required"
  | "kill_switch_engaged"
  | "managed_run_limit"
  | "runtime_limit"
  | "work_complete";

export interface UnattendedSchedulerResultV1 {
  schemaVersion: 1;
  kind: "unattended_scheduler.result";
  status: "completed" | "paused" | "attention_required";
  reasonCode: UnattendedSchedulerResultReasonV1;
  schedulerSessionId: string;
  startedAt: string;
  finishedAt: string;
  counts: {
    cycles: number;
    claims: number;
    managedRuns: number;
    completedAssignments: number;
    retryRuns: number;
    recoverableRaces: number;
    consecutiveFailures: number;
  };
  limits: {
    maximumCycles: number;
    maximumClaims: number;
    maximumManagedRuns: number;
    maximumRuntimeMs: number;
    maximumConsecutiveFailures: number;
  };
  lastSelection: UnattendedSchedulerSelectionV1 | null;
}
