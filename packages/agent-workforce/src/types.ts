import type { AssignmentAmendmentCoordinateV1 } from "@lervo/application-contract";
import type { AssignmentRecoveryCoordinateV1 } from "@lervo/application-contract";
import type { AssignmentTopologyPolicyReviewBindingV1 } from "@lervo/application-contract";

export type WorkforceProvider = "codex" | "claude" | "any";
export type AgentStatus = "active" | "suspended" | "retired";
export type AssignmentStatus =
  "queued" | "leased" | "blocked" | "completed" | "failed" | "cancelled";
export type AssignmentAccessMode = "read_only" | "write";

export interface WorkforceAgent {
  schemaVersion: 1;
  agentId: string;
  projectId: string;
  displayName: string;
  displayNameSource: "explicit" | "generated" | "legacy_derived";
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
  /**
   * Whether the agent is the team's, hired by the owner, onboarding, or a team agent, or Lervo's
   * own, hired by a Lervo service such as knowledge convergence (ADR-0643). Absent on a record from
   * before the field, which the upgrade's origin stage fills.
   */
  origin?: AgentOrigin;
  /**
   * The model and effort the agent's sessions run with (ADR-0647): chosen by its role when a team
   * agent is hired, and changed by the owner. Absent on Lervo's own agents, which run under
   * Lervo's model routes, and on a team agent hired before the field, whose role then decides.
   */
  model?: AgentModel;
  /**
   * The image the owner chose for the agent (Lervo ADE agents, "The profile"), stored once as a
   * repository asset by its hash, as a project's mark is. Absent until the owner chooses one.
   */
  mark?: AgentMark;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentOrigin = "team" | "lervo";

/**
 * How capable a model an agent runs on, in the provider's own line-up: its most capable, a strong
 * one, a balanced one, or a fast one. The provider's adapter names the model of each tier.
 */
export const modelTiers = ["frontier", "strong", "balanced", "fast"] as const;
export type ModelTier = (typeof modelTiers)[number];

/** How much the model thinks and works before it answers, lowest first. */
export const modelEfforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type ModelEffort = (typeof modelEfforts)[number];

/** An agent's image, as a project's mark: the asset's hash and format. */
export interface AgentMark {
  sha256: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}

export interface AgentModel {
  tier: ModelTier;
  effort: ModelEffort;
  /** `role` while the role's default stands, `owner` once the owner chose. */
  source: "role" | "owner";
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

export interface WorkforceHandoffTriggerProvenance {
  kind: "reviewed_direct_message";
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  sourceEventId: string;
  sourceEventKeyHash: string;
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
  trigger?: WorkforceHandoffTriggerProvenance | null;
}

export interface WorkforceAssignmentRoutineProvenance {
  routineId: string;
  templateVersion: string;
  templateHash: string;
  invocationId: string;
  triggerKind: "manual" | "authenticated_live";
  triggerDigest: string;
  nodeKey: string;
}

export interface WorkforceAssignmentTopologyProvenance {
  contractVersion: 2;
  changeId: string;
  changeKey: string;
  requestHash: string;
  planId: string;
  approvalHash: string;
  reviewerIdDigest: string;
  expectedNodeCount: number;
  nodeSetHash: string;
  nodeKey: string;
  policyReview?: AssignmentTopologyPolicyReviewBindingV1;
}

export interface WorkforceAssignmentKnowledgeJobProvenance {
  contractVersion: 1;
  jobId: string;
  completionEventId: string;
  completionEventHash: string;
  sourceConversationEventId: string;
  sourceManifestHash: string | null;
  agentId: string;
}

export interface WorkforceAssignmentConvergenceProvenance {
  contractVersion: 1;
  obligationId: string;
  baselineEventId: string;
  baselineEventHash: string;
  stage: string;
  inputArtifactHash: string;
  delegationHash: string;
  agentId: string;
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
  topology?: WorkforceAssignmentTopologyProvenance | null;
  knowledgeJob?: WorkforceAssignmentKnowledgeJobProvenance | null;
  convergence?: WorkforceAssignmentConvergenceProvenance | null;
  status: AssignmentStatus;
  priority: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
  /** Historical assignments without this field retain write-lease semantics. */
  accessMode?: AssignmentAccessMode;
  workstreamId: string | null;
  assigneeAgentId: string | null;
  lease: WorkforceLease | null;
  lastLeaseGeneration?: number;
  recovery?: WorkforceAssignmentRecovery;
  amendment?: AssignmentAmendmentCoordinateV1;
  handoffs: WorkforceHandoff[];
  resultArtifacts: WorkforceArtifactReference[];
  failureCode: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkforceAssignmentRecovery = AssignmentRecoveryCoordinateV1;

export interface WorkforceEvent {
  type:
    | "agent.registered"
    | "agent.identity.changed"
    | "agent.status.changed"
    | "assignment.created"
    | "assignment.claimed"
    | "assignment.lease.renewed"
    | "assignment.handoff.recorded"
    | "assignment.handoff.acknowledged"
    | "assignment.cancelled"
    | "assignment.completion.reconciled"
    | "assignment.role.binding.changed"
    | "assignment.amended"
    | "assignment.reopened"
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
      | "assignment_path_outside_responsibility"
      | "assignment_lease_conflict"
      | "assignment_cancellation_blocked"
      | "workspace_cleanup_blocked"
      | "workspace_dependency_blocked"
      | "workspace_integration_pending"
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
