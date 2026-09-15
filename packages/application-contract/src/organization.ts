export type OrganizationAction =
  | "team.propose"
  | "team.create"
  | "agent.hire"
  | "assignment.delegate"
  | "deliberation.convene"
  | "conversation.channel.create"
  | "conversation.thread.create"
  | "agent.deployment.prepare";

export interface OrganizationTeamOperatingInput {
  organizationId: string;
  teamId: string;
  teamKind: "central" | "project";
  projectId: string;
  repositoryIdentityHash: string;
  membershipCounts: { active: number; suspended: number; ended: number };
  deploymentCounts: { active: number; retired: number };
  activeChannelMembershipCount: number;
  activeDeliberationCount: number;
  activeAgentContextEntryCount: number;
  currentWorkstream: { workstreamId: string; revision: number; status: string } | null;
  sourceHeadSequence: number;
}

export interface OrganizationTeamOperatingSnapshot extends OrganizationTeamOperatingInput {
  snapshotHash: string;
}

export interface OrganizationOperatingReport {
  schemaVersion: 1;
  organizationId: string;
  status: "current" | "incomplete" | "conflict";
  teams: OrganizationTeamOperatingSnapshot[];
  issues: Array<
    | { code: "organization_mismatch"; teamId: string }
    | { code: "duplicate_team"; teamId: string }
    | { code: "duplicate_project"; projectId: string }
    | { code: "missing_central_team"; teamId: null }
  >;
  reportHash: string;
}

export interface CeoPolicy {
  schemaVersion: 1;
  policyId: string;
  organizationId: string;
  appointedAgentId: string;
  allowedActions: OrganizationAction[];
  approvalRequiredActions: OrganizationAction[];
  allowedTeamIds: string[];
  maximumAutomationDepth: number;
  budgetPolicyHash: string;
}

export interface CeoCommandRequest {
  schemaVersion: 1;
  requestId: string;
  organizationId: string;
  requestedByAgentId: string;
  action: OrganizationAction;
  teamId: string | null;
  risk: "low" | "medium" | "high";
  automationDepth: number;
  budget: { status: "within" | "reached" | "unknown"; policyHash: string };
  approvalId: string | null;
  effectHash?: string;
}

export interface CeoCommandDecision {
  schemaVersion: 1;
  requestId: string;
  policyId: string;
  status: "allowed" | "approval_required" | "denied";
  reason:
    | "policy_allows"
    | "approval_missing"
    | "appointment_mismatch"
    | "organization_mismatch"
    | "action_not_allowed"
    | "team_not_allowed"
    | "automation_depth_exceeded"
    | "budget_reached"
    | "budget_unknown"
    | "budget_policy_mismatch"
    | "operating_projection_conflict";
  decisionHash: string;
}

export interface OrganizationExecutiveEffect {
  schemaVersion: 1;
  effectId: string;
  organizationId: string;
  teamId: string | null;
  action: OrganizationAction;
  adapterId: string;
  parameters: unknown;
  parametersHash: string;
}

export interface OrganizationExecutiveEffectReceipt {
  schemaVersion: 1;
  effectId: string;
  requestId: string;
  decisionHash: string;
  effectHash: string;
  adapterId: string;
  externalEffectId: string;
  resultHash: string;
  completedAt: string;
}

export type OrganizationExecutiveEffectReplayDecision =
  | { status: "reserved" }
  | { status: "completed"; receipt: OrganizationExecutiveEffectReceipt }
  | { status: "unknown" | "rejected" | "conflict" };

export interface OrganizationExecutiveEffectReplayPort {
  begin(input: {
    effectId: string;
    requestId: string;
    effectHash: string;
    attemptedAt: string;
  }): Promise<OrganizationExecutiveEffectReplayDecision>;
  complete(receipt: OrganizationExecutiveEffectReceipt): Promise<void>;
  markUnknown(input: { effectId: string; requestId: string; effectHash: string }): Promise<void>;
  markRejected(input: { effectId: string; requestId: string; effectHash: string }): Promise<void>;
}

export interface OrganizationExecutiveEffectPort {
  readonly adapterId: string;
  readonly actions: readonly OrganizationAction[];
  apply(effect: Readonly<OrganizationExecutiveEffect>): Promise<
    | {
        status: "completed";
        externalEffectId: string;
        resultHash: string;
        completedAt: string;
      }
    | { status: "rejected"; reasonCode: string }
  >;
}

export type OrganizationExecutiveExecutionResult =
  | { status: "not_allowed"; decision: CeoCommandDecision }
  | {
      status: "completed" | "replayed";
      decision: CeoCommandDecision;
      receipt: OrganizationExecutiveEffectReceipt;
    }
  | { status: "uncertain" | "rejected"; decision: CeoCommandDecision; effectHash: string };
