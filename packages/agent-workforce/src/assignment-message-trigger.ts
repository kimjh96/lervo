import { createHash } from "node:crypto";

import type { AssignmentMentionRoutePlan } from "./assignment-mention-routing.js";
import type {
  WorkforceArtifactReference,
  WorkforceHandoff,
  WorkforceHandoffTriggerProvenance,
} from "./types.js";

export interface AssignmentMessageTriggerDescriptorV1 {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  availability: "available" | "unavailable";
  sourceEvidence: "reviewed_input";
  reviewBoundary: "exact_plan_apply";
  replayProtection: "source_event_key";
  externalIdentifiers: "excluded";
  capabilities: ["direct_message.handoff"];
}

export interface AssignmentMessageTriggerObservationV1 {
  schemaVersion: 1;
  kind: "direct_message";
  eventId: string;
  sourceEventKeyHash: string;
  projectId: string;
  workstreamId: string;
  fromAgentId: string;
  toAgentId: string;
  content: WorkforceArtifactReference;
  occurredAt: string;
}

export interface AssignmentMessageTriggerRequestV1 {
  schemaVersion: 1;
  adapterId: string;
  assignmentId: string;
  leaseId: string;
  source: AssignmentMessageTriggerObservationV1;
  contextEvidenceEventIds: string[];
}

export interface AssignmentMessageTriggerInspectionV1 {
  descriptor: AssignmentMessageTriggerDescriptorV1;
  observation: AssignmentMessageTriggerObservationV1;
}

export interface AssignmentMessageTriggerAdapterV1 {
  inspect(input: {
    adapterId: string;
    source: AssignmentMessageTriggerObservationV1;
  }): Promise<AssignmentMessageTriggerInspectionV1>;
}

export type AssignmentMessageTriggerBlockedReasonV1 =
  | "adapter_mismatch"
  | "adapter_unavailable"
  | "assignment_route_blocked"
  | "message_route_mismatch"
  | "source_event_conflict"
  | "source_mismatch";

export interface AssignmentMessageTriggerPlanV1 {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "current" | "blocked";
  disposition: "record_handoff" | "already_recorded" | "blocked";
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  sourceEventId: string;
  sourceEventKeyHash: string;
  projectId: string;
  workstreamId: string;
  assignmentId: string;
  assignmentRevision: number;
  fromAgentId: string;
  toAgentId: string;
  content: WorkforceArtifactReference;
  routePlanId: string;
  existingHandoffId: string | null;
  observedAt: string;
  blockedReasons: AssignmentMessageTriggerBlockedReasonV1[];
}

export interface AssignmentMessageTriggerResultV1 {
  plan: AssignmentMessageTriggerPlanV1;
  handoffId: string | null;
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ADAPTER_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const EVENT_ID = /^cve_[a-f0-9]{64}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function assignmentMessageTriggerDescriptorHash(
  descriptor: Omit<AssignmentMessageTriggerDescriptorV1, "descriptorHash">,
): string {
  return digest(descriptor);
}

function exactDescriptor(descriptor: AssignmentMessageTriggerDescriptorV1): boolean {
  const { descriptorHash, ...material } = descriptor;
  return (
    descriptor.schemaVersion === 1 &&
    ADAPTER_ID.test(descriptor.adapterId) &&
    descriptor.adapterId.length <= 128 &&
    VERSION.test(descriptor.adapterVersion) &&
    HASH.test(descriptorHash) &&
    descriptorHash === assignmentMessageTriggerDescriptorHash(material) &&
    descriptor.sourceEvidence === "reviewed_input" &&
    descriptor.reviewBoundary === "exact_plan_apply" &&
    descriptor.replayProtection === "source_event_key" &&
    descriptor.externalIdentifiers === "excluded" &&
    stableJson(descriptor.capabilities) === stableJson(["direct_message.handoff"])
  );
}

function exactSource(
  left: AssignmentMessageTriggerObservationV1,
  right: AssignmentMessageTriggerObservationV1,
): boolean {
  return stableJson(left) === stableJson(right);
}

function assertInput(input: {
  request: AssignmentMessageTriggerRequestV1;
  descriptor: AssignmentMessageTriggerDescriptorV1;
  observation: AssignmentMessageTriggerObservationV1;
  routePlan: AssignmentMentionRoutePlan;
  existingHandoffs: readonly WorkforceHandoff[];
}): void {
  const source = input.request.source;
  if (
    input.request.schemaVersion !== 1 ||
    input.request.adapterId.length > 128 ||
    !ADAPTER_ID.test(input.request.adapterId) ||
    source.schemaVersion !== 1 ||
    source.kind !== "direct_message" ||
    !EVENT_ID.test(source.eventId) ||
    !HASH.test(source.sourceEventKeyHash) ||
    !HASH.test(source.content.contentHash) ||
    !Number.isFinite(Date.parse(source.occurredAt)) ||
    input.request.contextEvidenceEventIds.length > 64 ||
    new Set(input.request.contextEvidenceEventIds).size !==
      input.request.contextEvidenceEventIds.length ||
    input.existingHandoffs.length > 256
  ) {
    throw new TypeError("The assignment message trigger input is invalid or exceeds its bounds.");
  }
}

function triggerProvenance(
  descriptor: AssignmentMessageTriggerDescriptorV1,
  source: AssignmentMessageTriggerObservationV1,
): WorkforceHandoffTriggerProvenance {
  return {
    kind: "reviewed_direct_message",
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    descriptorHash: descriptor.descriptorHash,
    sourceEventId: source.eventId,
    sourceEventKeyHash: source.sourceEventKeyHash,
  };
}

function exactExistingHandoff(input: {
  handoff: WorkforceHandoff;
  descriptor: AssignmentMessageTriggerDescriptorV1;
  source: AssignmentMessageTriggerObservationV1;
  request: AssignmentMessageTriggerRequestV1;
}): boolean {
  return (
    input.handoff.fromAgentId === input.source.fromAgentId &&
    input.handoff.toAgentId === input.source.toAgentId &&
    input.handoff.requestDigest === input.source.content.contentHash &&
    stableJson(input.handoff.artifactReferences) === stableJson([input.source.content]) &&
    stableJson(input.handoff.contextEvidenceEventIds) ===
      stableJson(input.request.contextEvidenceEventIds) &&
    stableJson(input.handoff.trigger ?? null) ===
      stableJson(triggerProvenance(input.descriptor, input.source))
  );
}

export function createAssignmentMessageTriggerPlan(input: {
  request: AssignmentMessageTriggerRequestV1;
  descriptor: AssignmentMessageTriggerDescriptorV1;
  observation: AssignmentMessageTriggerObservationV1;
  routePlan: AssignmentMentionRoutePlan;
  existingHandoffs: readonly WorkforceHandoff[];
  observedAt: string;
}): AssignmentMessageTriggerPlanV1 {
  assertInput(input);
  if (!Number.isFinite(Date.parse(input.observedAt))) {
    throw new TypeError("The assignment message trigger observation time is invalid.");
  }
  const { request, descriptor, observation, routePlan } = input;
  const blocked = new Set<AssignmentMessageTriggerBlockedReasonV1>();
  if (!exactDescriptor(descriptor) || descriptor.adapterId !== request.adapterId) {
    blocked.add("adapter_mismatch");
  }
  if (descriptor.availability !== "available") blocked.add("adapter_unavailable");
  if (!exactSource(observation, request.source)) blocked.add("source_mismatch");
  if (
    observation.projectId !== routePlan.projectId ||
    observation.workstreamId !== routePlan.workstreamId ||
    Date.parse(observation.occurredAt) > Date.parse(input.observedAt)
  ) {
    blocked.add("source_mismatch");
  }
  if (
    request.assignmentId !== routePlan.assignmentId ||
    request.leaseId !== routePlan.leaseId ||
    observation.fromAgentId !== routePlan.fromAgentId ||
    routePlan.target.kind !== "agent" ||
    observation.toAgentId !== routePlan.target.agentId ||
    routePlan.requestDigest !== observation.content.contentHash ||
    stableJson(routePlan.artifactReferences) !== stableJson([observation.content]) ||
    stableJson(routePlan.contextEvidenceEventIds) !== stableJson(request.contextEvidenceEventIds)
  ) {
    blocked.add("message_route_mismatch");
  }

  const sameSource = input.existingHandoffs.filter(
    (handoff) =>
      handoff.trigger?.adapterId === descriptor.adapterId &&
      handoff.trigger.sourceEventKeyHash === observation.sourceEventKeyHash,
  );
  const existing = sameSource.find((handoff) =>
    exactExistingHandoff({ handoff, descriptor, source: observation, request }),
  );
  if (sameSource.length > 1 || (sameSource.length === 1 && existing === undefined)) {
    blocked.add("source_event_conflict");
  }
  if (routePlan.status !== "ready" && existing === undefined) {
    blocked.add("assignment_route_blocked");
  }

  const blockedReasons = [...blocked].sort();
  const status: AssignmentMessageTriggerPlanV1["status"] =
    blockedReasons.length > 0 ? "blocked" : existing === undefined ? "ready" : "current";
  const disposition: AssignmentMessageTriggerPlanV1["disposition"] =
    status === "blocked" ? "blocked" : status === "current" ? "already_recorded" : "record_handoff";
  const content = {
    schemaVersion: 1 as const,
    status,
    disposition,
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    descriptorHash: descriptor.descriptorHash,
    sourceEventId: observation.eventId,
    sourceEventKeyHash: observation.sourceEventKeyHash,
    projectId: observation.projectId,
    workstreamId: observation.workstreamId,
    assignmentId: request.assignmentId,
    assignmentRevision: routePlan.assignmentRevision,
    fromAgentId: observation.fromAgentId,
    toAgentId: observation.toAgentId,
    content: structuredClone(observation.content),
    routePlanId: routePlan.planId,
    existingHandoffId: existing?.handoffId ?? null,
    observedAt: input.observedAt,
    blockedReasons,
  };
  const { observedAt: _observedAt, ...planMaterial } = content;
  return {
    ...content,
    planId: `amtp_${digest(planMaterial).slice("sha256:".length, "sha256:".length + 24)}`,
  };
}

export function assignmentMessageTriggerProvenance(
  plan: AssignmentMessageTriggerPlanV1,
): WorkforceHandoffTriggerProvenance {
  if (plan.status !== "ready") {
    throw new TypeError("Only a ready assignment message trigger plan can record a handoff.");
  }
  return {
    kind: "reviewed_direct_message",
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    descriptorHash: plan.descriptorHash,
    sourceEventId: plan.sourceEventId,
    sourceEventKeyHash: plan.sourceEventKeyHash,
  };
}
