export interface AssignmentConnectorDescriptorV1 {
  schemaVersion: 1;
  connectorId: string;
  connectorVersion: string;
  descriptorHash: string;
  availability: "available" | "unavailable";
  authentication: "adapter_verified";
  replayProtection: "durable_pre_send";
  externalIdentifiers: "adapter_private";
  capabilities: ["artifact.send"];
}

export interface AssignmentConnectorDestinationV1 {
  schemaVersion: 1;
  connectorId: string;
  destinationId: string;
  integrationId: string;
  bindingHash: string;
  status: "active" | "inactive";
}

export interface AssignmentConnectorPublicationV1 {
  surface: "chat";
  permitId: string;
  permitHash: string;
  artifactId: string;
  contentHash: string;
}

export interface AssignmentConnectorRequestV1 {
  schemaVersion: 1;
  workstreamId: string;
  assignmentId: string;
  handoffId: string;
  handoffEventId: string;
  artifactId: string;
  contentHash: string;
  requestDigest: string;
  descriptor: AssignmentConnectorDescriptorV1;
  destination: AssignmentConnectorDestinationV1;
  publication: AssignmentConnectorPublicationV1;
}

export interface AssignmentConnectorSourceObservationV1 {
  projectId: string;
  workstreamId: string | null;
  assignmentId: string;
  assignmentRevision: number;
  handoffId: string;
  handoffEventId: string;
  fromAgentId: string;
  toAgentId: string;
  requestDigest: string;
  artifactReferences: { artifactId: string; contentHash: string }[];
  routeRecordedAt: string;
}

export type AssignmentConnectorBlockedReasonV1 =
  | "artifact_not_routed"
  | "connector_unavailable"
  | "destination_inactive"
  | "destination_mismatch"
  | "handoff_event_mismatch"
  | "publication_mismatch"
  | "request_mismatch"
  | "source_mismatch"
  | "workstream_mismatch";

export interface AssignmentConnectorRoutePlanV1 {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  workstreamId: string;
  assignmentId: string;
  assignmentRevision: number;
  handoffId: string;
  handoffEventId: string;
  fromAgentId: string;
  toAgentId: string;
  artifactId: string;
  contentHash: string;
  requestDigest: string;
  connectorId: string;
  connectorVersion: string;
  descriptorHash: string;
  destinationId: string;
  integrationId: string;
  destinationBindingHash: string;
  permitId: string;
  permitHash: string;
  attemptDigest: string;
  outboundId: string;
  blockedReasons: AssignmentConnectorBlockedReasonV1[];
}

export interface AssignmentConnectorDeliveryObservationV1 {
  schemaVersion: 1;
  planId: string;
  outboundId: string;
  connectorId: string;
  destinationId: string;
  status: "delivered" | "rejected" | "unknown";
  reservationId: string;
  attemptDigest: string;
  deliveryReceiptHash: string | null;
  deliveryKeyHash: string | null;
  attemptedAt: string;
  deliveredAt: string | null;
  failureCode: "platform_delivery_rejected" | "platform_delivery_unknown" | null;
}

export type AssignmentConnectorReservationV1 =
  | {
      status: "reserved";
      reservationId: string;
      attemptDigest: string;
      authorizationReceiptHash: string;
      reservedAt: string;
    }
  | {
      status: "current";
      observation: AssignmentConnectorDeliveryObservationV1;
    }
  | {
      status: "conflict";
      reason: "reservation_conflict";
    };

export interface AssignmentConnectorPortV1 {
  inspect(input: { connectorId: string; destinationId: string }): Promise<{
    descriptor: AssignmentConnectorDescriptorV1;
    destination: AssignmentConnectorDestinationV1;
  }>;
  reserve(plan: AssignmentConnectorRoutePlanV1): Promise<AssignmentConnectorReservationV1>;
  deliver(input: {
    plan: AssignmentConnectorRoutePlanV1;
    reservationId: string;
  }): Promise<AssignmentConnectorDeliveryObservationV1>;
}

export interface AssignmentConnectorRouteResultV1 {
  plan: AssignmentConnectorRoutePlanV1;
  delivery: AssignmentConnectorDeliveryObservationV1 | null;
}
