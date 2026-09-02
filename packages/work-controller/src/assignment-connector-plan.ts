import type {
  AssignmentConnectorBlockedReasonV1,
  AssignmentConnectorRequestV1,
  AssignmentConnectorRoutePlanV1,
  AssignmentConnectorSourceObservationV1,
} from "@lervo/application-contract";

import {
  assignmentConnectorDigest,
  assignmentConnectorOpaqueId,
  exactAssignmentConnectorDescriptor,
  validateAssignmentConnectorInput,
} from "./assignment-connector-validation.js";

export interface CreateAssignmentConnectorRoutePlanInput {
  currentWorkstreamId: string;
  request: AssignmentConnectorRequestV1;
  source: AssignmentConnectorSourceObservationV1;
}

export function createAssignmentConnectorRoutePlan(
  input: CreateAssignmentConnectorRoutePlanInput,
): AssignmentConnectorRoutePlanV1 {
  validateAssignmentConnectorInput(input);
  const { request, source } = input;
  const blocked = new Set<AssignmentConnectorBlockedReasonV1>();
  if (
    request.workstreamId !== input.currentWorkstreamId ||
    source.workstreamId !== input.currentWorkstreamId
  )
    blocked.add("workstream_mismatch");
  if (request.descriptor.availability !== "available") blocked.add("connector_unavailable");
  if (request.destination.status !== "active") blocked.add("destination_inactive");
  if (
    request.descriptor.connectorId !== request.destination.connectorId ||
    !exactAssignmentConnectorDescriptor(request.descriptor)
  )
    blocked.add("destination_mismatch");
  if (
    request.publication.artifactId !== request.artifactId ||
    request.publication.contentHash !== request.contentHash
  )
    blocked.add("publication_mismatch");
  if (source.assignmentId !== request.assignmentId || source.handoffId !== request.handoffId)
    blocked.add("source_mismatch");
  if (source.handoffEventId !== request.handoffEventId) blocked.add("handoff_event_mismatch");
  if (source.requestDigest !== request.requestDigest) blocked.add("request_mismatch");
  if (
    !source.artifactReferences.some(
      (artifact) =>
        artifact.artifactId === request.artifactId && artifact.contentHash === request.contentHash,
    )
  )
    blocked.add("artifact_not_routed");

  const outboundMaterial = {
    projectId: source.projectId,
    workstreamId: input.currentWorkstreamId,
    assignmentId: request.assignmentId,
    handoffId: request.handoffId,
    handoffEventId: request.handoffEventId,
    artifactId: request.artifactId,
    contentHash: request.contentHash,
    requestDigest: request.requestDigest,
    descriptorHash: request.descriptor.descriptorHash,
    destinationBindingHash: request.destination.bindingHash,
    permitHash: request.publication.permitHash,
  };
  const outboundId = assignmentConnectorOpaqueId("acout", outboundMaterial);
  const attemptDigest = assignmentConnectorDigest({
    outboundId,
    connectorId: request.descriptor.connectorId,
    connectorVersion: request.descriptor.connectorVersion,
    destinationId: request.destination.destinationId,
    integrationId: request.destination.integrationId,
  });
  const content = {
    schemaVersion: 1 as const,
    status: blocked.size === 0 ? ("ready" as const) : ("blocked" as const),
    projectId: source.projectId,
    workstreamId: input.currentWorkstreamId,
    assignmentId: request.assignmentId,
    assignmentRevision: source.assignmentRevision,
    handoffId: request.handoffId,
    handoffEventId: request.handoffEventId,
    fromAgentId: source.fromAgentId,
    toAgentId: source.toAgentId,
    artifactId: request.artifactId,
    contentHash: request.contentHash,
    requestDigest: request.requestDigest,
    connectorId: request.descriptor.connectorId,
    connectorVersion: request.descriptor.connectorVersion,
    descriptorHash: request.descriptor.descriptorHash,
    destinationId: request.destination.destinationId,
    integrationId: request.destination.integrationId,
    destinationBindingHash: request.destination.bindingHash,
    permitId: request.publication.permitId,
    permitHash: request.publication.permitHash,
    attemptDigest,
    outboundId,
    blockedReasons: [...blocked].sort(),
  };
  return { ...content, planId: assignmentConnectorOpaqueId("acplan", content) };
}

export {
  assertAssignmentConnectorDeliveryObservation,
  assertAssignmentConnectorReservation,
  assignmentConnectorDigest,
} from "./assignment-connector-validation.js";
