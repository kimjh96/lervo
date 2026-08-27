import type {
  GroundingDecision,
  ProtocolCoordinate,
  SemanticGroundingProposal,
} from "@lervo/request-grounding";

import type { WorkforceAgent, WorkforceAssignment } from "./types.js";

export interface NaturalLanguageWorkforcePlan {
  schemaVersion: 1;
  planKind: "natural_language_workforce_request";
  requestDigest: string;
  intent: "hire" | "assign" | "inspect" | "resolve" | "handoff" | "retire" | "unrecognized";
  status: "ready" | "pending_decision" | "read_only" | "unrecognized";
  roleId: string | null;
  agentId: string | null;
  assignmentId: string | null;
  pending: Array<{
    field: "intent" | "role" | "agent" | "assignment" | "scope" | "authority";
    reason: string;
  }>;
  operation: {
    namespace: "agent" | "assignment" | "workstream";
    action: string;
    authority: "read" | "local_state_write" | "user_approval";
  } | null;
  privacy: { rawRequestPersisted: false; eventPayload: "digest_and_coordinates_only" };
}

export interface NaturalLanguageRoleDescriptor {
  roleId: string;
  name: string;
  sourceKind: "built_in" | "repository";
}

const operations = {
  "workforce.inspect": {
    intent: "inspect",
    namespace: "assignment",
    action: "list",
    authority: "read",
  },
  "workforce.hire": {
    intent: "hire",
    namespace: "agent",
    action: "hire",
    authority: "local_state_write",
  },
  "workforce.assign": {
    intent: "assign",
    namespace: "assignment",
    action: "create",
    authority: "local_state_write",
  },
  "workforce.resolve": {
    intent: "resolve",
    namespace: "workstream",
    action: "resolve_pending",
    authority: "user_approval",
  },
  "workforce.handoff": {
    intent: "handoff",
    namespace: "assignment",
    action: "handoff",
    authority: "local_state_write",
  },
  "workforce.retire": {
    intent: "retire",
    namespace: "agent",
    action: "retire",
    authority: "local_state_write",
  },
} as const;

function coordinates(
  proposal: SemanticGroundingProposal,
  kind: ProtocolCoordinate["kind"],
): string[] {
  return proposal.protocolCoordinates
    .filter((coordinate) => coordinate.kind === kind)
    .map((coordinate) => coordinate.value);
}

/** Deterministically maps a validated semantic decision; it never receives raw request text. */
export function planGroundedWorkforceRequest(input: {
  proposal: SemanticGroundingProposal;
  decision: GroundingDecision;
  agents: readonly WorkforceAgent[];
  assignments: readonly WorkforceAssignment[];
  roles?: readonly NaturalLanguageRoleDescriptor[];
}): NaturalLanguageWorkforcePlan {
  const operation =
    input.decision.workflowId === null
      ? null
      : (operations[input.decision.workflowId as keyof typeof operations] ?? null);
  const roleIds = input.proposal.subjectIds
    .filter((subject) => subject.startsWith("role."))
    .map((subject) => subject.slice("role.".length))
    .filter((roleId) => input.roles?.some((role) => role.roleId === roleId) ?? false);
  const agentIds = coordinates(input.proposal, "agent_id");
  const assignmentIds = coordinates(input.proposal, "assignment_id");
  const scopePaths = coordinates(input.proposal, "repository_path");
  const roleId = roleIds.length === 1 ? roleIds[0]! : null;
  const agentId =
    agentIds.length === 1 && input.agents.some((agent) => agent.agentId === agentIds[0])
      ? agentIds[0]!
      : null;
  const assignmentId =
    assignmentIds.length === 1 &&
    input.assignments.some((assignment) => assignment.assignmentId === assignmentIds[0])
      ? assignmentIds[0]!
      : null;
  const pending: NaturalLanguageWorkforcePlan["pending"] = [];
  if (operation === null)
    pending.push({
      field: "intent",
      reason: input.decision.reasons[0] ?? "No validated workforce workflow was selected.",
    });
  if ((operation?.intent === "hire" || operation?.intent === "assign") && roleId === null)
    pending.push({
      field: "role",
      reason: "One role subject from the supplied role catalog is required.",
    });
  if (operation?.intent === "retire" && agentId === null)
    pending.push({ field: "agent", reason: "Retirement requires one existing exact agent ID." });
  if (operation?.intent === "handoff" && (agentIds.length !== 2 || assignmentId === null)) {
    if (assignmentId === null)
      pending.push({
        field: "assignment",
        reason: "Handoff requires one existing exact assignment ID.",
      });
    if (agentIds.length !== 2)
      pending.push({
        field: "agent",
        reason: "Handoff requires exact source and recipient agent IDs.",
      });
  }
  if (operation?.intent === "resolve" && assignmentId === null)
    pending.push({
      field: "assignment",
      reason: "Resolution requires one exact pending assignment coordinate.",
    });
  if (operation?.intent === "assign" && scopePaths.length === 0)
    pending.push({
      field: "scope",
      reason: "Assignment requires an exact safe repository_path coordinate.",
    });
  if (input.decision.status === "approval_required")
    pending.push({
      field: "authority",
      reason: "The validated operation requires explicit authority.",
    });
  return {
    schemaVersion: 1,
    planKind: "natural_language_workforce_request",
    requestDigest: input.proposal.requestDigest,
    intent: operation?.intent ?? "unrecognized",
    status:
      operation === null
        ? "unrecognized"
        : pending.length > 0
          ? "pending_decision"
          : operation.intent === "inspect"
            ? "read_only"
            : "ready",
    roleId,
    agentId,
    assignmentId,
    pending,
    operation:
      operation === null
        ? null
        : {
            namespace: operation.namespace,
            action: operation.action,
            authority: operation.authority,
          },
    privacy: { rawRequestPersisted: false, eventPayload: "digest_and_coordinates_only" },
  };
}
