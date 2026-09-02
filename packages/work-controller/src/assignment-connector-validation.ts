import { createHash } from "node:crypto";

import type {
  AssignmentConnectorDeliveryObservationV1,
  AssignmentConnectorRequestV1,
  AssignmentConnectorReservationV1,
  AssignmentConnectorRoutePlanV1,
  AssignmentConnectorSourceObservationV1,
} from "@lervo/application-contract";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID = /^prj_[a-f0-9]{16}$/u;
const WORKSTREAM_ID = /^wks_[a-f0-9]{24}$/u;
const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

function bounded(value: unknown, prefix?: string): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    (prefix === undefined || value.startsWith(`${prefix}_`))
  );
}

function publicationPermitId(value: unknown): value is string {
  return (
    bounded(value, "permit") || (typeof value === "string" && /^wpp_[a-f0-9]{16}$/u.test(value))
  );
}

function exactKeys(value: object, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

export function stableAssignmentConnectorJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAssignmentConnectorJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableAssignmentConnectorJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function assignmentConnectorDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableAssignmentConnectorJson(value))
    .digest("hex")}`;
}

export function assignmentConnectorOpaqueId(prefix: "acout" | "acplan", value: unknown): string {
  return `${prefix}_${assignmentConnectorDigest(value).slice("sha256:".length, 24)}`;
}

export function validateAssignmentConnectorInput(input: {
  currentWorkstreamId: string;
  request: AssignmentConnectorRequestV1;
  source: AssignmentConnectorSourceObservationV1;
}): void {
  const { request, source } = input;
  if (
    !WORKSTREAM_ID.test(input.currentWorkstreamId) ||
    request.schemaVersion !== 1 ||
    !WORKSTREAM_ID.test(request.workstreamId) ||
    !ASSIGNMENT_ID.test(request.assignmentId) ||
    !bounded(request.handoffId, "hnd") ||
    !bounded(request.handoffEventId, "evt") ||
    !bounded(request.artifactId, "art") ||
    !HASH.test(request.contentHash) ||
    !HASH.test(request.requestDigest)
  )
    throw new TypeError("The assignment connector request coordinates are invalid.");
  if (
    request.descriptor.schemaVersion !== 1 ||
    !bounded(request.descriptor.connectorId, "con") ||
    !VERSION.test(request.descriptor.connectorVersion) ||
    !HASH.test(request.descriptor.descriptorHash) ||
    !["available", "unavailable"].includes(request.descriptor.availability) ||
    request.descriptor.authentication !== "adapter_verified" ||
    request.descriptor.replayProtection !== "durable_pre_send" ||
    request.descriptor.externalIdentifiers !== "adapter_private" ||
    request.descriptor.capabilities.length !== 1 ||
    request.descriptor.capabilities[0] !== "artifact.send"
  )
    throw new TypeError("The assignment connector descriptor is invalid.");
  if (
    request.destination.schemaVersion !== 1 ||
    !bounded(request.destination.connectorId, "con") ||
    !bounded(request.destination.destinationId, "dst") ||
    !bounded(request.destination.integrationId, "int") ||
    !HASH.test(request.destination.bindingHash) ||
    !["active", "inactive"].includes(request.destination.status)
  )
    throw new TypeError("The assignment connector destination is invalid.");
  if (
    request.publication.surface !== "chat" ||
    !publicationPermitId(request.publication.permitId) ||
    !HASH.test(request.publication.permitHash) ||
    !bounded(request.publication.artifactId, "art") ||
    !HASH.test(request.publication.contentHash)
  )
    throw new TypeError("The assignment connector publication binding is invalid.");
  if (
    !PROJECT_ID.test(source.projectId) ||
    (source.workstreamId !== null && !WORKSTREAM_ID.test(source.workstreamId)) ||
    !ASSIGNMENT_ID.test(source.assignmentId) ||
    !Number.isSafeInteger(source.assignmentRevision) ||
    source.assignmentRevision < 1 ||
    !bounded(source.handoffId, "hnd") ||
    !bounded(source.handoffEventId, "evt") ||
    !bounded(source.fromAgentId, "agt") ||
    !bounded(source.toAgentId, "agt") ||
    !HASH.test(source.requestDigest) ||
    !Number.isFinite(Date.parse(source.routeRecordedAt)) ||
    source.artifactReferences.length === 0 ||
    source.artifactReferences.length > 128 ||
    source.artifactReferences.some(
      (artifact) => !bounded(artifact.artifactId, "art") || !HASH.test(artifact.contentHash),
    )
  )
    throw new TypeError("The assignment connector source observation is invalid.");
}

export function assertAssignmentConnectorDeliveryObservation(
  plan: AssignmentConnectorRoutePlanV1,
  observation: AssignmentConnectorDeliveryObservationV1,
): AssignmentConnectorDeliveryObservationV1 {
  if (
    plan.status !== "ready" ||
    observation.schemaVersion !== 1 ||
    observation.planId !== plan.planId ||
    observation.outboundId !== plan.outboundId ||
    observation.connectorId !== plan.connectorId ||
    observation.destinationId !== plan.destinationId ||
    observation.attemptDigest !== plan.attemptDigest ||
    !bounded(observation.reservationId, "acres") ||
    !Number.isFinite(Date.parse(observation.attemptedAt)) ||
    !["delivered", "rejected", "unknown"].includes(observation.status)
  )
    throw new TypeError("The assignment connector delivery observation is foreign or invalid.");
  const delivered = observation.status === "delivered";
  if (
    delivered !== (observation.failureCode === null) ||
    delivered !== (observation.deliveryReceiptHash !== null) ||
    delivered !== (observation.deliveryKeyHash !== null) ||
    delivered !== (observation.deliveredAt !== null) ||
    (delivered &&
      (!HASH.test(observation.deliveryReceiptHash!) ||
        !HASH.test(observation.deliveryKeyHash!) ||
        !Number.isFinite(Date.parse(observation.deliveredAt!)))) ||
    (observation.status === "rejected" &&
      observation.failureCode !== "platform_delivery_rejected") ||
    (observation.status === "unknown" && observation.failureCode !== "platform_delivery_unknown")
  )
    throw new TypeError("The assignment connector delivery outcome is contradictory.");
  return observation;
}

export function assertAssignmentConnectorReservation(
  plan: AssignmentConnectorRoutePlanV1,
  reservation: AssignmentConnectorReservationV1,
): AssignmentConnectorReservationV1 {
  if (plan.status !== "ready")
    throw new TypeError("A blocked assignment connector plan cannot reserve delivery.");
  if (reservation.status === "current") {
    assertAssignmentConnectorDeliveryObservation(plan, reservation.observation);
    return reservation;
  }
  if (reservation.status === "conflict") return reservation;
  if (
    !bounded(reservation.reservationId, "acres") ||
    reservation.attemptDigest !== plan.attemptDigest ||
    !HASH.test(reservation.authorizationReceiptHash) ||
    !Number.isFinite(Date.parse(reservation.reservedAt))
  )
    throw new TypeError("The assignment connector reservation evidence is invalid.");
  return reservation;
}

export function exactAssignmentConnectorDescriptor(
  value: AssignmentConnectorRequestV1["descriptor"],
): boolean {
  return exactKeys(value, [
    "authentication",
    "availability",
    "capabilities",
    "connectorId",
    "connectorVersion",
    "descriptorHash",
    "externalIdentifiers",
    "replayProtection",
    "schemaVersion",
  ]);
}
