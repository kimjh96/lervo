import { knowledgeMaintenanceEventTypes } from "./knowledge-maintenance-event.js";
import type { FromSchema } from "json-schema-to-ts";

import {
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  runIdSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { documentFreshnessEventTypes } from "./document-freshness-event.js";
import { instructionCaptureEventTypes } from "./instruction-capture-event.js";
import { hostedSessionEventTypes } from "./hosted-session-event.js";
import { terminalBaseDeliveryEventTypes } from "./terminal-base-delivery-event.js";
import { roomEventTypes } from "./room-event.js";
import { planLedgerEventTypes } from "./plan-ledger-event.js";
import { resourceUsageBeforeV11 } from "./resource-usage-event.js";
import { terminalTurnObservedBeforeV12 } from "./terminal-observation-event.js";
import { executionStagesObservedBeforeV13 } from "./execution-observability-event.js";

export const eventTypesV1 = [
  "run.requested",
  "run.resolved",
  "run.completed",
  "run.failed",
  "context.recommended",
  "context.selected",
  "document.loaded",
  "context.injected",
  "adapter.result.captured",
  "context.referenced",
  "context.invalidated",
  "context.published",
  "handoff.created",
  "adapter.started",
  "adapter.stopped",
  "capability.requested",
  "capability.decided",
  "capability.activated",
  "capability.recommended",
  "capability.selected",
  "capability.loaded",
  "capability.invoked",
  "capability.completed",
  "tool.called",
  "command.executed",
  "file.changed",
  "skill.resolved",
  "skill.invoked",
  "skill.completed",
  "verification.started",
  "verification.completed",
  "deliberation.started",
  "deliberation.artifact.recorded",
  "deliberation.artifact.publication_failed",
  "deliberation.completed",
  // Historical development-pattern events retained for stored-event validation.
  "development.pattern.observed",
  "development.pattern.transitioned",
  "development.pattern.evaluation.registered",
  "development.pattern.effect.observed",
  "knowledge.candidate.created",
  "knowledge.candidate.reviewed",
  "knowledge.reconciliation.reviewed",
  "knowledge.verified",
  "knowledge.stale.detected",
  "knowledge.materialization.applied",
  "state.pruned",
  "terminal.integration.applied",
  "terminal.context.prepared",
  "terminal.turn.declared",
  "terminal.reference.observed",
  "terminal.turn.observed",
  "workstream.snapshot.recorded",
  "agent.registered",
  "agent.identity.changed",
  "agent.status.changed",
  "assignment.created",
  "assignment.claimed",
  "assignment.lease.renewed",
  "assignment.handoff.recorded",
  "assignment.handoff.acknowledged",
  "assignment.cancelled",
  "assignment.completion.prepared",
  "assignment.completion.reconciled",
  "assignment.completed",
  "assignment.role.binding.changed",
  "assignment.amended",
  "assignment.reopened",
  "public_readme.improvement.applied",
  "document.stale.detected",
  "document.migration.applied",
  "project.identity.migrated",
  "unmanaged_change.detected",
  "sync.acknowledged",
  "organization.team.bound",
  "organization.team.kind.changed",
  "organization.agent.identity.changed",
  "organization.agent.membership.changed",
  "organization.external_agent.deployment.bound",
  "organization.external_agent.deployment.retired",
  "organization.channel.membership.changed",
  "organization.deliberation.participant.bound",
  "organization.deliberation.participant.released",
  "agent.context.promoted",
  "agent.context.handoff.recorded",
] as const;

export const eventTypesV2 = [
  ...eventTypesV1,
  "conversation.repository_work.completed",
  "agent.liveness.observed",
  "provider.process.observed",
  "work.causality.recorded",
  "resource.usage.recorded",
  "execution.stages.observed",
  "role.profile.activated",
] as const;

export const supervisionEventTypes = [
  "work.supervision.mandate.installed",
  "work.supervision.mandate.revoked",
  "work.supervision.bound",
  "work.responsibility.bound",
  "work.supervision.decision.recorded",
  "work.supervision.decision.superseded",
  "work.supervision.owner_reasoning.interruption_reconciled",
  "work.supervision.effect.observed",
  "work.supervision.readiness.failed",
  "work.supervision.preflight.blocked",
  "work.supervision.preflight.resolved",
  "work.supervision.review.recorded",
  "work.supervision.workspace.prepared",
  "work.supervision.delivery.queued",
  "work.supervision.delivery.observed",
  "work.supervision.escalation.recorded",
  "work.supervision.handoff.offered",
  "work.supervision.handoff.accepted",
  "work.supervision.peer.observed",
] as const;

export const eventTypesV3 = [
  ...eventTypesV2,
  "conversation.repository_knowledge.resolved",
  "repository.change.completed",
  "repository.knowledge.resolved",
  ...supervisionEventTypes,
  "managed.execution.reserved",
  "role.input.bound",
] as const;
export const eventTypesV4 = [
  ...eventTypesV3,
  "repository.knowledge.baseline.requested",
  "repository.knowledge.stage.recorded",
  "repository.knowledge.convergence.recorded",
  "assignment.convergence.archived",
  "repository.replica.diverged",
  "repository.replica.reconciled",
  ...documentFreshnessEventTypes,
  ...instructionCaptureEventTypes,
  "knowledge.convergence.owner.changed",
  "knowledge.convergence.delegation.continued",
  "provider.cli.admitted",
  "provider.cli.rejected",
  "knowledge.convergence.definitions.installed",
  "knowledge.publication.repaired",
  "knowledge.integration_target.absorbed",
] as const;
export const eventTypesV5 = [...eventTypesV4, ...knowledgeMaintenanceEventTypes] as const;
export const eventTypesV6 = [
  ...eventTypesV5,
  "context.quality.prepared",
  "context.quality.verified",
] as const;
export const eventTypesV7 = [
  ...eventTypesV6,
  "terminal.skill.observed",
  "terminal.skill.turn_assessed",
] as const;
export const eventTypesV8 = [
  ...eventTypesV7,
  "learning.observation.recorded",
  "knowledge.skill_candidate.proposed",
  "knowledge.skill_candidate.resolved",
  "knowledge.skill.usage_assessed",
  "knowledge.skill.retired",
] as const;
/** ADR-0563: the plan ledger. */
export const eventTypesV9 = [...eventTypesV8, ...planLedgerEventTypes] as const;
/** ADR-0613: the ADE's hosted sessions. */
export const eventTypesV10 = [...eventTypesV9, ...hostedSessionEventTypes] as const;
/**
 * ADR-0632: no new type. `resource.usage.recorded` may carry a hosted session's usage, which
 * `resourceUsageBeforeV11` keeps out of the envelope versions older readers accept.
 */
export const eventTypesV11 = eventTypesV10;
/**
 * No new type. `terminal.turn.observed` may say how a turn ended without a Stop hook, which
 * `terminalTurnObservedBeforeV12` keeps out of older envelope versions.
 */
export const eventTypesV12 = eventTypesV11;
/**
 * No new type. `execution.stages.observed` may say how a terminal hook's answer was delivered,
 * which `executionStagesObservedBeforeV13` keeps out of older envelope versions.
 */
export const eventTypesV13 = eventTypesV12;
/** ADR-0645: the launcher answered an unserved prompt from the checkout's cached base. */
export const eventTypesV14 = [...eventTypesV13, ...terminalBaseDeliveryEventTypes] as const;
/** ADR-0641: agents mentioning each other in an ADE conversation. */
export const eventTypesV15 = [...eventTypesV14, ...roomEventTypes] as const;
export const eventTypes = eventTypesV15;

const eventEnvelopeProperties = {
  eventId: eventIdSchema,
  projectId: projectIdSchema,
  runId: runIdSchema,
  sessionId: sessionIdSchema,
  seq: { type: "integer", minimum: 1 },
  occurredAt: timestampSchema,
  actor: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["user", "agent", "system", "provider"] },
      provider: providerSchema,
    },
    required: ["kind"],
    additionalProperties: false,
  },
  policyVersion: sha256Schema,
  payload: { type: "object" },
  previousHash: { anyOf: [sha256Schema, { type: "null" }] },
  eventHash: sha256Schema,
} as const;

const eventEnvelopeRequired = [
  "eventId",
  "projectId",
  "runId",
  "sessionId",
  "seq",
  "type",
  "occurredAt",
  "actor",
  "schemaVersion",
  "policyVersion",
  "payload",
  "previousHash",
  "eventHash",
] as const;

const eventEnvelopeInvariants = [
  {
    if: { properties: { seq: { const: 1 } }, required: ["seq"] },
    then: { properties: { previousHash: { type: "null" } } },
    else: { properties: { previousHash: sha256Schema } },
  },
  {
    if: {
      properties: {
        actor: {
          type: "object",
          properties: { kind: { enum: ["agent", "provider"] } },
          required: ["kind"],
        },
      },
    },
    then: {
      properties: {
        actor: {
          type: "object",
          properties: { kind: { type: "string" }, provider: providerSchema },
          required: ["kind", "provider"],
        },
      },
    },
  },
  resourceUsageBeforeV11,
  terminalTurnObservedBeforeV12,
  executionStagesObservedBeforeV13,
] as const;

export const eventEnvelopeV1Schema = {
  type: "object",
  properties: {
    ...eventEnvelopeProperties,
    type: { type: "string", enum: eventTypesV1 },
    schemaVersion: { type: "integer", const: 1 },
  },
  required: eventEnvelopeRequired,
  allOf: eventEnvelopeInvariants,
  additionalProperties: false,
} as const;

export const eventEnvelopeV2Schema = {
  type: "object",
  properties: {
    ...eventEnvelopeProperties,
    type: { type: "string", enum: eventTypesV2 },
    schemaVersion: { type: "integer", const: 2 },
  },
  required: eventEnvelopeRequired,
  allOf: eventEnvelopeInvariants,
  additionalProperties: false,
} as const;

export const eventEnvelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event.schema.json",
  title: "Lervo readable append-only event envelope",
  type: "object",
  properties: {
    ...eventEnvelopeProperties,
    type: { type: "string" },
    schemaVersion: { type: "integer" },
  },
  required: eventEnvelopeRequired,
  allOf: eventEnvelopeInvariants,
  additionalProperties: false,
  oneOf: [
    {
      properties: {
        type: { enum: eventTypesV1 },
        schemaVersion: { const: 1 },
      },
    },
    {
      properties: {
        type: { enum: eventTypesV2 },
        schemaVersion: { const: 2 },
      },
    },
    {
      properties: {
        type: { enum: eventTypesV3 },
        schemaVersion: { const: 3 },
      },
    },
    {
      properties: {
        type: { enum: eventTypesV4 },
        schemaVersion: { const: 4 },
      },
    },
    {
      properties: {
        type: { enum: eventTypesV5 },
        schemaVersion: { const: 5 },
      },
    },
    {
      properties: {
        type: { enum: eventTypesV6 },
        schemaVersion: { const: 6 },
      },
    },
    { properties: { type: { enum: eventTypesV7 }, schemaVersion: { const: 7 } } },
    { properties: { type: { enum: eventTypesV8 }, schemaVersion: { const: 8 } } },
    { properties: { type: { enum: eventTypesV9 }, schemaVersion: { const: 9 } } },
    { properties: { type: { enum: eventTypesV10 }, schemaVersion: { const: 10 } } },
    { properties: { type: { enum: eventTypesV11 }, schemaVersion: { const: 11 } } },
    { properties: { type: { enum: eventTypesV12 }, schemaVersion: { const: 12 } } },
    { properties: { type: { enum: eventTypesV13 }, schemaVersion: { const: 13 } } },
    { properties: { type: { enum: eventTypesV14 }, schemaVersion: { const: 14 } } },
    { properties: { type: { enum: eventTypesV15 }, schemaVersion: { const: 15 } } },
  ],
} as const;

export type EventEnvelopeV1 = FromSchema<typeof eventEnvelopeV1Schema>;
export type EventEnvelopeV2 = FromSchema<typeof eventEnvelopeV2Schema>;
export type EventEnvelopeV3 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 3;
  type: (typeof eventTypesV3)[number];
};
export type EventEnvelopeV4 = Omit<EventEnvelopeV3, "schemaVersion" | "type"> & {
  schemaVersion: 4;
  type: (typeof eventTypesV4)[number];
};
export type EventEnvelopeV5 = Omit<EventEnvelopeV4, "schemaVersion" | "type"> & {
  schemaVersion: 5;
  type: (typeof eventTypesV5)[number];
};
export type EventEnvelopeV6 = Omit<EventEnvelopeV5, "schemaVersion" | "type"> & {
  schemaVersion: 6;
  type: (typeof eventTypesV6)[number];
};
export type EventEnvelopeV7 = Omit<EventEnvelopeV6, "schemaVersion" | "type"> & {
  schemaVersion: 7;
  type: (typeof eventTypesV7)[number];
};
export type EventEnvelopeV8 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 8;
  type: (typeof eventTypesV8)[number];
};
export type EventEnvelopeV9 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 9;
  type: (typeof eventTypesV9)[number];
};
export type EventEnvelopeV10 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 10;
  type: (typeof eventTypesV10)[number];
};
export type EventEnvelopeV11 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 11;
  type: (typeof eventTypesV11)[number];
};
export type EventEnvelopeV12 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 12;
  type: (typeof eventTypesV12)[number];
};
export type EventEnvelopeV13 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 13;
  type: (typeof eventTypesV13)[number];
};
export type EventEnvelopeV14 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 14;
  type: (typeof eventTypesV14)[number];
};
export type EventEnvelopeV15 = Omit<EventEnvelopeV2, "schemaVersion" | "type"> & {
  schemaVersion: 15;
  type: (typeof eventTypesV15)[number];
};
export type EventEnvelope = Omit<EventEnvelopeV15, "schemaVersion"> & {
  schemaVersion:
    | EventEnvelopeV1["schemaVersion"]
    | EventEnvelopeV2["schemaVersion"]
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15;
};
/**
 * `T` with its `events` typed as non-empty `EventEnvelope`s, keeping every other property and any
 * index signature. Reports use it because the envelope schema, with one branch per event schema
 * version, is too deep for `FromSchema`.
 */
export type WithEnvelopeEvents<T> = {
  [K in keyof T]: K extends "events" ? [EventEnvelope, ...EventEnvelope[]] : T[K];
};
export type EventTypeV1 = (typeof eventTypesV1)[number];
export type EventTypeV2 = (typeof eventTypesV2)[number];
export type EventType = (typeof eventTypesV15)[number];
