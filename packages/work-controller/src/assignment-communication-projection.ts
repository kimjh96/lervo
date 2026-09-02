import type {
  AssignmentCommunicationQueryV1,
  AssignmentCommunicationReportV1,
  AssignmentInboxRouteV1,
  AssignmentInteractionRouteV1,
  AssignmentInteractionThreadV1,
} from "@lervo/application-contract";

import { shortId } from "./hash.js";

export interface AssignmentCommunicationAgentSourceV1 {
  agentId: string;
  status: "active" | "suspended" | "retired";
}

export interface AssignmentCommunicationSourceV1 {
  assignmentId: string;
  projectId: string;
  workstreamId: string | null;
  revision: number;
  status: AssignmentInteractionThreadV1["assignmentStatus"];
  handoffs: Array<{
    handoffId: string;
    fromAgentId: string;
    toAgentId: string;
    requestDigest: string;
    artifactReferences: Array<{ artifactId: string; contentHash: string }>;
    contextEvidenceEventIds: string[];
    createdAt: string;
  }>;
}

const limitations = [
  "Interaction bodies remain content-addressed artifacts and are not present in this report.",
  "A recorded route proves neither delivery, provider receipt, understanding, nor action.",
  "Mention resolution and handoff recording do not grant task, lease, approval, or provider authority.",
];

function threadId(input: {
  projectId: string;
  workstreamId: string;
  assignmentId: string;
}): string {
  return shortId("ath", input);
}

function route(input: {
  threadId: string;
  assignmentId: string;
  handoff: AssignmentCommunicationSourceV1["handoffs"][number];
}): AssignmentInteractionRouteV1 {
  return {
    schemaVersion: 1,
    threadId: input.threadId,
    handoffId: input.handoff.handoffId,
    assignmentId: input.assignmentId,
    fromAgentId: input.handoff.fromAgentId,
    toAgentId: input.handoff.toAgentId,
    requestDigest: input.handoff.requestDigest,
    artifactReferences: input.handoff.artifactReferences
      .map((artifact) => ({ ...artifact }))
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId)),
    contextEvidenceEventIds: [...input.handoff.contextEvidenceEventIds].sort(),
    routedAt: input.handoff.createdAt,
    routeState: "recorded",
    deliveryState: "unobserved",
    acknowledgementState: "unobserved",
  };
}

function validity(input: {
  query: AssignmentCommunicationQueryV1;
  assignments: readonly AssignmentCommunicationSourceV1[];
  agents: readonly AssignmentCommunicationAgentSourceV1[];
}): string[] {
  const reasons = new Set<string>();
  const assignmentIds = input.assignments.map((assignment) => assignment.assignmentId);
  const handoffIds = input.assignments.flatMap((assignment) =>
    assignment.handoffs.map((handoff) => handoff.handoffId),
  );
  const agentIds = new Set(input.agents.map((agent) => agent.agentId));
  if (input.query.assignmentId !== null && input.assignments.length === 0) {
    reasons.add("assignment_not_found");
  }
  if (input.query.recipientAgentId !== null && !agentIds.has(input.query.recipientAgentId)) {
    reasons.add("recipient_agent_missing");
  }
  if (new Set(assignmentIds).size !== assignmentIds.length) reasons.add("duplicate_assignment");
  if (new Set(handoffIds).size !== handoffIds.length) reasons.add("duplicate_handoff");
  for (const assignment of input.assignments) {
    if (assignment.handoffs.some((handoff) => !agentIds.has(handoff.fromAgentId))) {
      reasons.add("handoff_source_agent_missing");
    }
    if (assignment.handoffs.some((handoff) => !agentIds.has(handoff.toAgentId))) {
      reasons.add("handoff_recipient_agent_missing");
    }
  }
  return [...reasons].sort();
}

export function projectAssignmentCommunications(input: {
  query: AssignmentCommunicationQueryV1;
  assignments: readonly AssignmentCommunicationSourceV1[];
  agents: readonly AssignmentCommunicationAgentSourceV1[];
}): AssignmentCommunicationReportV1 {
  if (!Number.isFinite(Date.parse(input.query.observedAt))) {
    throw new TypeError("The assignment communication observation time is invalid.");
  }
  const scopedAssignments = input.assignments
    .filter(
      (assignment) =>
        assignment.projectId === input.query.projectId &&
        assignment.workstreamId === input.query.workstreamId &&
        (input.query.assignmentId === null || assignment.assignmentId === input.query.assignmentId),
    )
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId));
  const reasonCodes = validity({
    query: input.query,
    assignments: scopedAssignments,
    agents: input.agents,
  });
  const agentStatus = new Map(input.agents.map((agent) => [agent.agentId, agent.status]));
  const threads = scopedAssignments
    .map<AssignmentInteractionThreadV1>((assignment) => {
      const id = threadId({
        projectId: input.query.projectId,
        workstreamId: input.query.workstreamId,
        assignmentId: assignment.assignmentId,
      });
      const routes = assignment.handoffs
        .filter(
          (handoff) =>
            input.query.recipientAgentId === null ||
            handoff.toAgentId === input.query.recipientAgentId,
        )
        .map((handoff) => route({ threadId: id, assignmentId: assignment.assignmentId, handoff }))
        .sort(
          (left, right) =>
            left.routedAt.localeCompare(right.routedAt) ||
            left.handoffId.localeCompare(right.handoffId),
        );
      return {
        schemaVersion: 1,
        threadId: id,
        assignmentId: assignment.assignmentId,
        assignmentRevision: assignment.revision,
        assignmentStatus: assignment.status,
        routes,
      };
    })
    .filter((thread) => input.query.recipientAgentId === null || thread.routes.length > 0);
  const inbox = threads
    .flatMap((thread) =>
      thread.routes.map<AssignmentInboxRouteV1>((item) => ({
        schemaVersion: 1,
        inboxItemId: shortId("ain", {
          projectId: input.query.projectId,
          handoffId: item.handoffId,
          recipientAgentId: item.toAgentId,
        }),
        threadId: thread.threadId,
        handoffId: item.handoffId,
        assignmentId: item.assignmentId,
        fromAgentId: item.fromAgentId,
        recipientAgentId: item.toAgentId,
        recipientAgentStatus: agentStatus.get(item.toAgentId) ?? "missing",
        artifactCount: item.artifactReferences.length,
        routedAt: item.routedAt,
        routeState: item.routeState,
        deliveryState: item.deliveryState,
        acknowledgementState: item.acknowledgementState,
      })),
    )
    .filter(
      (item) =>
        input.query.recipientAgentId === null ||
        item.recipientAgentId === input.query.recipientAgentId,
    )
    .sort(
      (left, right) =>
        right.routedAt.localeCompare(left.routedAt) ||
        left.inboxItemId.localeCompare(right.inboxItemId),
    );
  return {
    schemaVersion: 1,
    projectId: input.query.projectId,
    workstreamId: input.query.workstreamId,
    observedAt: input.query.observedAt,
    validity: {
      status: reasonCodes.length === 0 ? "valid" : "invalid",
      reasonCodes,
    },
    threads,
    inbox,
    limitations: [...limitations],
  };
}
