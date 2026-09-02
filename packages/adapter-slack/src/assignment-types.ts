import type {
  AssignmentConnectorDeliveryObservationV1,
  AssignmentConnectorDestinationV1,
  AssignmentConnectorReservationV1,
  AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";
import type { WritingPublicationPermit } from "@lervo/schemas";

export type SlackAssignmentCredentialV1 =
  | { status: "unavailable" }
  | {
      status: "available";
      credentialId: string;
      botToken: string;
      teamId: string;
    };

export interface SlackAssignmentCredentialSourceV1 {
  resolve(input: { integrationId: string }): Promise<SlackAssignmentCredentialV1>;
}

export interface SlackAssignmentNativeDestinationV1 {
  public: AssignmentConnectorDestinationV1;
  teamId: string;
  channelId: string;
  threadTs: string | null;
}

export interface SlackAssignmentDestinationSourceV1 {
  resolve(input: {
    connectorId: string;
    destinationId: string;
  }): Promise<SlackAssignmentNativeDestinationV1>;
}

export interface SlackAssignmentArtifactSourceV1 {
  read(input: { artifactId: string }): Promise<Uint8Array>;
}

export interface SlackAssignmentPermitSourceV1 {
  read(input: { permitId: string }): Promise<WritingPublicationPermit>;
}

export type SlackAssignmentTransportResultV1 =
  | { status: "delivered"; messageTs: string; deliveredAt: string }
  | { status: "rejected" }
  | { status: "unknown" };

export interface SlackAssignmentTransportV1 {
  send(input: {
    botToken: string;
    teamId: string;
    channelId: string;
    threadTs: string | null;
    text: string;
  }): Promise<SlackAssignmentTransportResultV1>;
}

export type SlackAssignmentDeliveryStartV1 =
  | { status: "ready" }
  | { status: "current"; observation: AssignmentConnectorDeliveryObservationV1 }
  | { status: "conflict" };

export interface SlackAssignmentConnectorStateV1 {
  reserve(input: {
    plan: AssignmentConnectorRoutePlanV1;
    reservationId: string;
    authorizationReceiptHash: string;
    reservedAt: string;
  }): Promise<AssignmentConnectorReservationV1>;
  beginDelivery(input: {
    plan: AssignmentConnectorRoutePlanV1;
    reservationId: string;
    attemptedAt: string;
  }): Promise<SlackAssignmentDeliveryStartV1>;
  complete(observation: AssignmentConnectorDeliveryObservationV1): Promise<void>;
}
