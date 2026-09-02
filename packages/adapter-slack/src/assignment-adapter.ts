import {
  AssignmentConnectorPortError,
  type AssignmentConnectorDeliveryObservationV1,
  type AssignmentConnectorDescriptorV1,
  type AssignmentConnectorPortV1,
  type AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";

import { slackAssignmentDigest, slackAssignmentOpaqueId } from "./assignment-digest.js";
import type {
  SlackAssignmentArtifactSourceV1,
  SlackAssignmentConnectorStateV1,
  SlackAssignmentCredentialSourceV1,
  SlackAssignmentDestinationSourceV1,
  SlackAssignmentPermitSourceV1,
  SlackAssignmentTransportV1,
} from "./assignment-types.js";
import {
  assertSlackAssignmentPlan,
  assertSlackDeliveryObservation,
  assertSlackNativeDestination,
  assertSlackPublicBoundary,
  assertSlackReservationResult,
  assertSlackWritingPermit,
  decodeSlackArtifact,
} from "./assignment-validation.js";

export const SLACK_ASSIGNMENT_CONNECTOR_VERSION = "1.0.0";

export interface SlackAssignmentConnectorOptionsV1 {
  connectorId: string;
  connectorVersion?: string;
  credentials: SlackAssignmentCredentialSourceV1;
  destinations: SlackAssignmentDestinationSourceV1;
  artifacts: SlackAssignmentArtifactSourceV1;
  permits: SlackAssignmentPermitSourceV1;
  state: SlackAssignmentConnectorStateV1;
  transport: SlackAssignmentTransportV1;
  now?: () => Date;
}

interface AuthorizedSlackAssignment {
  botToken: string;
  teamId: string;
  channelId: string;
  threadTs: string | null;
  text: string;
  authorizationReceiptHash: string;
}

function descriptor(input: {
  connectorId: string;
  connectorVersion: string;
  availability: "available" | "unavailable";
}): AssignmentConnectorDescriptorV1 {
  const content = {
    schemaVersion: 1 as const,
    connectorId: input.connectorId,
    connectorVersion: input.connectorVersion,
    availability: input.availability,
    authentication: "adapter_verified" as const,
    replayProtection: "durable_pre_send" as const,
    externalIdentifiers: "adapter_private" as const,
    capabilities: ["artifact.send"] as ["artifact.send"],
  };
  return { ...content, descriptorHash: slackAssignmentDigest(content) };
}

export class SlackAssignmentConnector implements AssignmentConnectorPortV1 {
  private readonly now: () => Date;
  private readonly connectorVersion: string;

  constructor(private readonly options: SlackAssignmentConnectorOptionsV1) {
    if (
      !options.connectorId.startsWith("con_") ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(
        options.connectorVersion ?? SLACK_ASSIGNMENT_CONNECTOR_VERSION,
      )
    ) {
      throw new AssignmentConnectorPortError(
        "request_invalid",
        "The Slack assignment connector identity is invalid.",
      );
    }
    this.connectorVersion = options.connectorVersion ?? SLACK_ASSIGNMENT_CONNECTOR_VERSION;
    this.now = options.now ?? (() => new Date());
  }

  async inspect(input: { connectorId: string; destinationId: string }) {
    if (input.connectorId !== this.options.connectorId) {
      throw new AssignmentConnectorPortError(
        "connector_not_found",
        "The requested assignment connector is not available.",
      );
    }
    const destination = await this.options.destinations.resolve(input);
    const credential = await this.options.credentials.resolve({
      integrationId: destination.public.integrationId,
    });
    return {
      descriptor: descriptor({
        connectorId: this.options.connectorId,
        connectorVersion: this.connectorVersion,
        availability: credential.status === "available" ? "available" : "unavailable",
      }),
      destination: destination.public,
    };
  }

  async reserve(plan: AssignmentConnectorRoutePlanV1) {
    const authorization = await this.authorize(plan);
    const reservedAt = this.timestamp();
    const reservation = await this.options.state.reserve({
      plan,
      reservationId: slackAssignmentOpaqueId("acres", {
        outboundId: plan.outboundId,
        attemptDigest: plan.attemptDigest,
      }),
      authorizationReceiptHash: authorization.authorizationReceiptHash,
      reservedAt,
    });
    return assertSlackReservationResult({
      plan,
      authorizationReceiptHash: authorization.authorizationReceiptHash,
      reservation,
    });
  }

  async deliver(input: { plan: AssignmentConnectorRoutePlanV1; reservationId: string }) {
    const authorization = await this.authorize(input.plan);
    const attemptedAt = this.timestamp();
    const start = await this.options.state.beginDelivery({ ...input, attemptedAt });
    if (start.status === "current") {
      return assertSlackDeliveryObservation(input.plan, start.observation, input.reservationId);
    }
    if (start.status === "conflict") {
      throw new AssignmentConnectorPortError(
        "reservation_conflict",
        "The Slack assignment delivery reservation conflicts with durable state.",
      );
    }
    const result = await this.options.transport.send({
      botToken: authorization.botToken,
      teamId: authorization.teamId,
      channelId: authorization.channelId,
      threadTs: authorization.threadTs,
      text: authorization.text,
    });
    const observation = this.observation(input.plan, input.reservationId, attemptedAt, result);
    try {
      await this.options.state.complete(observation);
    } catch (error) {
      throw new AssignmentConnectorPortError(
        "delivery_state_invalid",
        "The Slack delivery result could not be recorded durably.",
        { cause: error },
      );
    }
    return observation;
  }

  private async authorize(
    plan: AssignmentConnectorRoutePlanV1,
  ): Promise<AuthorizedSlackAssignment> {
    assertSlackAssignmentPlan(plan);
    const [boundary, destination, credential, bytes, permit] = await Promise.all([
      this.inspect({ connectorId: plan.connectorId, destinationId: plan.destinationId }),
      this.options.destinations.resolve({
        connectorId: plan.connectorId,
        destinationId: plan.destinationId,
      }),
      this.options.credentials.resolve({ integrationId: plan.integrationId }),
      this.options.artifacts.read({ artifactId: plan.artifactId }),
      this.options.permits.read({ permitId: plan.permitId }),
    ]);
    assertSlackPublicBoundary({ plan, ...boundary });
    assertSlackNativeDestination(destination);
    if (credential.status !== "available") {
      throw new AssignmentConnectorPortError(
        "credential_unavailable",
        "The Slack assignment credential is unavailable.",
      );
    }
    if (credential.teamId !== destination.teamId) {
      throw new AssignmentConnectorPortError(
        "authorization_failed",
        "The Slack credential and destination scopes differ.",
      );
    }
    const text = decodeSlackArtifact(bytes, plan.contentHash);
    assertSlackWritingPermit({
      permit,
      permitId: plan.permitId,
      permitHash: plan.permitHash,
      artifactId: plan.artifactId,
      contentHash: plan.contentHash,
    });
    return {
      botToken: credential.botToken,
      teamId: destination.teamId,
      channelId: destination.channelId,
      threadTs: destination.threadTs,
      text,
      authorizationReceiptHash: slackAssignmentDigest({
        schemaVersion: 1,
        planId: plan.planId,
        outboundId: plan.outboundId,
        attemptDigest: plan.attemptDigest,
        credentialId: credential.credentialId,
        destinationBindingHash: destination.public.bindingHash,
        contentHash: plan.contentHash,
        permitHash: plan.permitHash,
      }),
    };
  }

  private observation(
    plan: AssignmentConnectorRoutePlanV1,
    reservationId: string,
    attemptedAt: string,
    result: Awaited<ReturnType<SlackAssignmentTransportV1["send"]>>,
  ): AssignmentConnectorDeliveryObservationV1 {
    const common = {
      schemaVersion: 1 as const,
      planId: plan.planId,
      outboundId: plan.outboundId,
      connectorId: plan.connectorId,
      destinationId: plan.destinationId,
      reservationId,
      attemptDigest: plan.attemptDigest,
      attemptedAt,
    };
    if (result.status !== "delivered") {
      return {
        ...common,
        status: result.status,
        deliveryReceiptHash: null,
        deliveryKeyHash: null,
        deliveredAt: null,
        failureCode:
          result.status === "rejected" ? "platform_delivery_rejected" : "platform_delivery_unknown",
      };
    }
    const deliveryKeyHash = slackAssignmentDigest({
      platform: "slack",
      outboundId: plan.outboundId,
      messageTs: result.messageTs,
    });
    return {
      ...common,
      status: "delivered",
      deliveryReceiptHash: slackAssignmentDigest({
        planId: plan.planId,
        reservationId,
        deliveryKeyHash,
        deliveredAt: result.deliveredAt,
      }),
      deliveryKeyHash,
      deliveredAt: result.deliveredAt,
      failureCode: null,
    };
  }

  private timestamp(): string {
    const value = this.now().toISOString();
    if (!Number.isFinite(Date.parse(value))) {
      throw new AssignmentConnectorPortError(
        "request_invalid",
        "The Slack assignment connector clock is invalid.",
      );
    }
    return value;
  }
}
