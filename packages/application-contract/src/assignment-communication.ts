import type { ApplicationAssignmentStatus } from "./types.js";

export interface AssignmentInteractionArtifactV1 {
  artifactId: string;
  contentHash: string;
}

export interface AssignmentInteractionRouteV1 {
  schemaVersion: 1;
  threadId: string;
  handoffId: string;
  assignmentId: string;
  fromAgentId: string;
  toAgentId: string;
  requestDigest: string;
  artifactReferences: AssignmentInteractionArtifactV1[];
  contextEvidenceEventIds: string[];
  routedAt: string;
  routeState: "recorded";
  deliveryState: "unobserved";
  acknowledgementState: "unobserved";
}

export interface AssignmentInteractionThreadV1 {
  schemaVersion: 1;
  threadId: string;
  assignmentId: string;
  assignmentRevision: number;
  assignmentStatus: ApplicationAssignmentStatus;
  routes: AssignmentInteractionRouteV1[];
}

export interface AssignmentInboxRouteV1 {
  schemaVersion: 1;
  inboxItemId: string;
  threadId: string;
  handoffId: string;
  assignmentId: string;
  fromAgentId: string;
  recipientAgentId: string;
  recipientAgentStatus: "active" | "suspended" | "retired" | "missing";
  artifactCount: number;
  routedAt: string;
  routeState: "recorded";
  deliveryState: "unobserved";
  acknowledgementState: "unobserved";
}

export interface AssignmentCommunicationReportV1 {
  schemaVersion: 1;
  projectId: string;
  workstreamId: string;
  observedAt: string;
  validity: {
    status: "valid" | "invalid";
    reasonCodes: string[];
  };
  threads: AssignmentInteractionThreadV1[];
  inbox: AssignmentInboxRouteV1[];
  limitations: string[];
}

export interface AssignmentCommunicationQueryV1 {
  schemaVersion: 1;
  kind: "assignment_communication.inspect";
  projectId: string;
  workstreamId: string;
  observedAt: string;
  assignmentId: string | null;
  recipientAgentId: string | null;
}
