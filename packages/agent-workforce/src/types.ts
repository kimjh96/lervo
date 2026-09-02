export type WorkforceProvider = "codex" | "claude" | "any";
export type AgentStatus = "active" | "suspended" | "retired";
export type AssignmentStatus =
  "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";

export interface WorkforceAgent {
  schemaVersion: 1;
  agentId: string;
  projectId: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  roleProfileHash: string;
  provider: WorkforceProvider;
  capabilityHash: string;
  skillIds: string[];
  capabilityPackages?: WorkforceCapabilityPackage[];
  responsibilityPaths: string[];
  parentAgentId: string | null;
  delegationDepth: number;
  status: AgentStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkforceCapabilityPackage {
  capabilityId: string;
  kind: "skill" | "mcp_server" | "provider_plugin" | "bundle";
  version: string;
  contentHash: string;
  sourceKind: "project" | "user";
}

export interface WorkforceLease {
  leaseId: string;
  agentId: string;
  sessionId: string;
  generation: number;
  acquiredAt: string;
  expiresAt: string;
}

export interface WorkforceArtifactReference {
  artifactId: string;
  contentHash: string;
}

export interface WorkforceHandoff {
  handoffId: string;
  fromAgentId: string;
  toAgentId: string;
  requestDigest: string;
  artifactReferences: WorkforceArtifactReference[];
  contextEvidenceEventIds: string[];
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface WorkforceAssignmentRoutineProvenance {
  routineId: string;
  templateVersion: string;
  templateHash: string;
  invocationId: string;
  triggerKind: "manual";
  triggerDigest: string;
  nodeKey: string;
}

export interface WorkforceAssignment {
  schemaVersion: 1;
  assignmentId: string;
  projectId: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash?: string | null;
  routine?: WorkforceAssignmentRoutineProvenance | null;
  status: AssignmentStatus;
  priority: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
  workstreamId: string | null;
  assigneeAgentId: string | null;
  lease: WorkforceLease | null;
  handoffs: WorkforceHandoff[];
  resultArtifacts: WorkforceArtifactReference[];
  failureCode: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkforceEvent {
  type:
    | "agent.registered"
    | "agent.status.changed"
    | "assignment.created"
    | "assignment.claimed"
    | "assignment.lease.renewed"
    | "assignment.handoff.recorded"
    | "assignment.cancelled"
    | "assignment.completion.reconciled"
    | "assignment.completed";
  occurredAt: string;
  actorAgentId: string | null;
  payload: Record<string, boolean | number | string | null | string[]>;
}

export type WorkforceEventRecorder = (event: WorkforceEvent) => void | Promise<void>;

export class AgentWorkforceError extends Error {
  constructor(
    readonly code:
      | "agent_invalid"
      | "agent_not_found"
      | "agent_state_conflict"
      | "assignment_invalid"
      | "assignment_not_found"
      | "assignment_dependency_blocked"
      | "assignment_path_conflict"
      | "assignment_lease_conflict"
      | "assignment_cancellation_blocked"
      | "workspace_cleanup_blocked"
      | "workspace_dependency_blocked"
      | "workspace_invalid"
      | "workspace_transition_conflict"
      | "workforce_busy"
      | "workforce_state_invalid"
      | "workforce_write_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentWorkforceError";
  }
}
