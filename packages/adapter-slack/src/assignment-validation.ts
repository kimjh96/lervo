import {
  AssignmentConnectorPortError,
  type AssignmentConnectorDeliveryObservationV1,
  type AssignmentConnectorDescriptorV1,
  type AssignmentConnectorDestinationV1,
  type AssignmentConnectorReservationV1,
  type AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";
import { validateSchema, type WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import { slackAssignmentBytesDigest, slackAssignmentDigest } from "./assignment-digest.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const SLACK_TEAM = /^T[A-Z0-9]{2,127}$/u;
const SLACK_CHANNEL = /^[CDG][A-Z0-9]{2,127}$/u;
const SLACK_TIMESTAMP = /^[0-9]{1,12}(?:\.[0-9]{1,6})?$/u;

export function assertSlackAssignmentPlan(plan: AssignmentConnectorRoutePlanV1): void {
  const { planId, ...content } = plan;
  const expectedPlanId = `acplan_${slackAssignmentDigest(content).slice(7, 24)}`;
  if (
    plan.schemaVersion !== 1 ||
    plan.status !== "ready" ||
    plan.blockedReasons.length !== 0 ||
    planId !== expectedPlanId ||
    !plan.connectorId.startsWith("con_") ||
    !plan.destinationId.startsWith("dst_") ||
    !plan.integrationId.startsWith("int_") ||
    !plan.outboundId.startsWith("acout_") ||
    !HASH.test(plan.attemptDigest) ||
    !HASH.test(plan.descriptorHash) ||
    !HASH.test(plan.destinationBindingHash) ||
    !HASH.test(plan.contentHash) ||
    !HASH.test(plan.permitHash)
  ) {
    throw new AssignmentConnectorPortError(
      "request_invalid",
      "The Slack assignment delivery plan is invalid or not ready.",
    );
  }
}

export function assertSlackPublicBoundary(input: {
  plan: AssignmentConnectorRoutePlanV1;
  descriptor: AssignmentConnectorDescriptorV1;
  destination: AssignmentConnectorDestinationV1;
}): void {
  const { plan, descriptor, destination } = input;
  if (
    descriptor.availability !== "available" ||
    descriptor.connectorId !== plan.connectorId ||
    descriptor.connectorVersion !== plan.connectorVersion ||
    descriptor.descriptorHash !== plan.descriptorHash ||
    destination.connectorId !== plan.connectorId ||
    destination.destinationId !== plan.destinationId ||
    destination.integrationId !== plan.integrationId ||
    destination.bindingHash !== plan.destinationBindingHash ||
    destination.status !== "active"
  ) {
    throw new AssignmentConnectorPortError(
      "authorization_failed",
      "The Slack connector boundary differs from the reviewed plan.",
    );
  }
}

export function assertSlackNativeDestination(input: {
  teamId: string;
  channelId: string;
  threadTs: string | null;
}): void {
  if (
    !SLACK_TEAM.test(input.teamId) ||
    !SLACK_CHANNEL.test(input.channelId) ||
    (input.threadTs !== null && !SLACK_TIMESTAMP.test(input.threadTs))
  ) {
    throw new AssignmentConnectorPortError(
      "destination_not_found",
      "The private Slack destination is invalid.",
    );
  }
}

export function assertSlackWritingPermit(input: {
  permit: WritingPublicationPermit;
  permitId: string;
  permitHash: string;
  artifactId: string;
  contentHash: string;
}): void {
  if (
    !validateSchema("writingPublicationPermit", input.permit).valid ||
    input.permit.permitId !== calculateWritingPublicationPermitId(input.permit) ||
    input.permit.permitId !== input.permitId ||
    slackAssignmentDigest(input.permit) !== input.permitHash ||
    input.permit.surface !== "chat" ||
    input.permit.artifactId !== input.artifactId ||
    input.permit.contentHash !== input.contentHash
  ) {
    throw new AssignmentConnectorPortError(
      "permit_invalid",
      "The Slack publication permit differs from the reviewed artifact.",
    );
  }
}

export function decodeSlackArtifact(bytes: Uint8Array, contentHash: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AssignmentConnectorPortError(
      "artifact_invalid",
      "The Slack assignment artifact is not valid UTF-8.",
      { cause: error },
    );
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > 16 * 1024 ||
    text.length > 4_000 ||
    text.includes("\u0000") ||
    slackAssignmentBytesDigest(bytes) !== contentHash
  ) {
    throw new AssignmentConnectorPortError(
      "artifact_invalid",
      "The Slack assignment artifact is empty, oversized, or has a different content hash.",
    );
  }
  return text;
}

export function assertSlackReservationResult(input: {
  plan: AssignmentConnectorRoutePlanV1;
  authorizationReceiptHash: string;
  reservation: AssignmentConnectorReservationV1;
}): AssignmentConnectorReservationV1 {
  const { reservation, plan } = input;
  if (reservation.status === "current") {
    assertSlackDeliveryObservation(plan, reservation.observation);
    return reservation;
  }
  if (reservation.status === "conflict") return reservation;
  if (
    !reservation.reservationId.startsWith("acres_") ||
    reservation.attemptDigest !== plan.attemptDigest ||
    reservation.authorizationReceiptHash !== input.authorizationReceiptHash ||
    !Number.isFinite(Date.parse(reservation.reservedAt))
  ) {
    throw new AssignmentConnectorPortError(
      "reservation_invalid",
      "The Slack assignment reservation evidence is invalid.",
    );
  }
  return reservation;
}

export function assertSlackDeliveryObservation(
  plan: AssignmentConnectorRoutePlanV1,
  value: AssignmentConnectorDeliveryObservationV1,
  reservationId?: string,
): AssignmentConnectorDeliveryObservationV1 {
  const delivered = value.status === "delivered";
  if (
    value.schemaVersion !== 1 ||
    value.planId !== plan.planId ||
    value.outboundId !== plan.outboundId ||
    value.connectorId !== plan.connectorId ||
    value.destinationId !== plan.destinationId ||
    value.attemptDigest !== plan.attemptDigest ||
    !value.reservationId.startsWith("acres_") ||
    (reservationId !== undefined && value.reservationId !== reservationId) ||
    !Number.isFinite(Date.parse(value.attemptedAt)) ||
    delivered !== (value.failureCode === null) ||
    delivered !== (value.deliveryReceiptHash !== null) ||
    delivered !== (value.deliveryKeyHash !== null) ||
    delivered !== (value.deliveredAt !== null) ||
    (delivered &&
      (!HASH.test(value.deliveryReceiptHash!) ||
        !HASH.test(value.deliveryKeyHash!) ||
        !Number.isFinite(Date.parse(value.deliveredAt!)))) ||
    (value.status === "rejected" && value.failureCode !== "platform_delivery_rejected") ||
    (value.status === "unknown" && value.failureCode !== "platform_delivery_unknown")
  ) {
    throw new AssignmentConnectorPortError(
      "delivery_state_invalid",
      "The Slack assignment delivery observation is foreign or contradictory.",
    );
  }
  return value;
}
