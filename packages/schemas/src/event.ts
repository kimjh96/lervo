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
export const eventTypes = eventTypesV6;

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
export type EventEnvelope = Omit<EventEnvelopeV6, "schemaVersion"> & {
  schemaVersion:
    EventEnvelopeV1["schemaVersion"] | EventEnvelopeV2["schemaVersion"] | 3 | 4 | 5 | 6;
};
export type EventTypeV1 = (typeof eventTypesV1)[number];
export type EventTypeV2 = (typeof eventTypesV2)[number];
export type EventType = (typeof eventTypesV6)[number];
