import type { AssignmentRoutineAuthenticatedLiveTriggerV1 } from "@lervo/application-contract";

import { liveWebhookAuthorizationHash, liveWebhookAuthorizationId } from "./authorization.js";
import { assertLiveTriggerDescriptor } from "./descriptor.js";
import { LIVE_TRIGGER_HASH, LIVE_TRIGGER_ID, liveTriggerHash, liveTriggerId } from "./integrity.js";
import {
  LiveTriggerContractError,
  type AuthenticatedLiveTriggerObservationV1,
  type LiveTriggerAdmissionBlockedReasonV1,
  type LiveTriggerAdmissionPlanV1,
  type LiveWebhookAuthorizationV1,
} from "./types.js";

export function assertAuthenticatedLiveTriggerObservation(
  observation: AuthenticatedLiveTriggerObservationV1,
): void {
  assertLiveTriggerDescriptor(observation.descriptor);
  if (
    observation.schemaVersion !== 1 ||
    observation.kind !== "authenticated_webhook" ||
    !LIVE_TRIGGER_ID.test(observation.sourceId) ||
    !LIVE_TRIGGER_ID.test(observation.credentialId) ||
    !LIVE_TRIGGER_ID.test(observation.eventType) ||
    !LIVE_TRIGGER_HASH.test(observation.sourceEventKeyHash) ||
    !LIVE_TRIGGER_HASH.test(observation.requestContentHash) ||
    !LIVE_TRIGGER_HASH.test(observation.authenticationReceiptHash) ||
    !Number.isFinite(Date.parse(observation.occurredAt)) ||
    !Number.isFinite(Date.parse(observation.authenticatedAt)) ||
    Date.parse(observation.occurredAt) > Date.parse(observation.authenticatedAt)
  ) {
    throw new LiveTriggerContractError(
      "observation_invalid",
      "The authenticated live-trigger observation is invalid or exceeds its bounds.",
    );
  }
}

export function createLiveTriggerAdmissionPlan(input: {
  projectId: string;
  currentWorkstreamId: string;
  authorization: LiveWebhookAuthorizationV1;
  observation: AuthenticatedLiveTriggerObservationV1;
  admittedAt: string;
}): LiveTriggerAdmissionPlanV1 {
  assertAuthenticatedLiveTriggerObservation(input.observation);
  const authorizationHash = liveWebhookAuthorizationHash(input.authorization);
  const descriptor = input.observation.descriptor;
  const blocked = new Set<LiveTriggerAdmissionBlockedReasonV1>();
  if (
    input.authorization.adapterId !== descriptor.adapterId ||
    input.authorization.adapterVersion !== descriptor.adapterVersion
  )
    blocked.add("adapter_mismatch");
  if (input.authorization.projectId !== input.projectId) blocked.add("project_mismatch");
  if (input.authorization.workstreamId !== input.currentWorkstreamId)
    blocked.add("workstream_mismatch");
  if (input.authorization.sourceId !== input.observation.sourceId) blocked.add("source_mismatch");
  if (input.authorization.credentialId !== input.observation.credentialId)
    blocked.add("credential_mismatch");
  if (!input.authorization.acceptedEventTypes.includes(input.observation.eventType))
    blocked.add("event_type_denied");
  const admitted = Date.parse(input.admittedAt);
  const observed = Date.parse(input.observation.occurredAt);
  if (!Number.isFinite(admitted) || observed > admitted) blocked.add("event_time_invalid");
  if (admitted < Date.parse(input.authorization.validFrom))
    blocked.add("authorization_not_yet_valid");
  if (admitted > Date.parse(input.authorization.expiresAt)) blocked.add("authorization_expired");
  const templateHash = liveTriggerHash(input.authorization.routine);
  const trigger: AssignmentRoutineAuthenticatedLiveTriggerV1 = {
    schemaVersion: 1,
    kind: "authenticated_live",
    requestDigest: input.observation.requestContentHash,
    idempotencyKey: input.observation.sourceEventKeyHash,
    observedAt: input.observation.occurredAt,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    descriptorHash: descriptor.descriptorHash,
    sourceId: input.observation.sourceId,
    authorizationHash,
    authenticationReceiptHash: input.observation.authenticationReceiptHash,
  };
  const request = {
    schemaVersion: 1 as const,
    workstreamId: input.authorization.workstreamId,
    template: structuredClone(input.authorization.routine),
    trigger,
  };
  const planMaterial = {
    projectId: input.projectId,
    workstreamId: input.currentWorkstreamId,
    descriptorHash: descriptor.descriptorHash,
    sourceId: input.observation.sourceId,
    sourceEventKeyHash: input.observation.sourceEventKeyHash,
    requestContentHash: input.observation.requestContentHash,
    authenticationReceiptHash: input.observation.authenticationReceiptHash,
    authorizationHash,
    templateHash,
  };
  const invocationFingerprintHash = liveTriggerHash(planMaterial);
  const blockedReasons = [...blocked].sort();
  return {
    schemaVersion: 1,
    planId: liveTriggerId("ltp", planMaterial),
    status: blockedReasons.length === 0 ? "ready" : "blocked",
    projectId: input.projectId,
    workstreamId: input.currentWorkstreamId,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    descriptorHash: descriptor.descriptorHash,
    sourceId: input.observation.sourceId,
    sourceEventKeyHash: input.observation.sourceEventKeyHash,
    requestContentHash: input.observation.requestContentHash,
    authenticationReceiptHash: input.observation.authenticationReceiptHash,
    authorizationId: liveWebhookAuthorizationId(input.authorization),
    authorizationHash,
    routineId: input.authorization.routine.routineId,
    templateVersion: input.authorization.routine.templateVersion,
    templateHash,
    invocationFingerprintHash,
    maximumAcceptedTriggers: input.authorization.maximumAcceptedTriggers,
    admittedAt: input.admittedAt,
    blockedReasons,
    request,
  };
}

export function assertReadyLiveTriggerPlan(plan: LiveTriggerAdmissionPlanV1): void {
  if (plan.status !== "ready" || plan.blockedReasons.length > 0) {
    throw new LiveTriggerContractError(
      "plan_blocked",
      `The live trigger is blocked: ${plan.blockedReasons.join(", ") || "unknown"}.`,
    );
  }
}
