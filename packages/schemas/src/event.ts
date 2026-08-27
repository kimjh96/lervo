import type { FromSchema } from "json-schema-to-ts";

import {
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  runIdSchema,
  schemaVersionSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

export const eventTypes = [
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
  "development.pattern.observed",
  "development.pattern.transitioned",
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
  "agent.status.changed",
  "assignment.created",
  "assignment.claimed",
  "assignment.lease.renewed",
  "assignment.handoff.recorded",
  "assignment.completed",
  "public_readme.improvement.applied",
  "document.stale.detected",
  "document.migration.applied",
  "project.identity.migrated",
  "unmanaged_change.detected",
  "sync.acknowledged",
] as const;

export const eventEnvelopeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/event.schema.json",
  title: "Lervo append-only event envelope",
  type: "object",
  properties: {
    eventId: eventIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    seq: {
      type: "integer",
      minimum: 1,
    },
    type: {
      type: "string",
      enum: eventTypes,
    },
    occurredAt: timestampSchema,
    actor: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["user", "agent", "system", "provider"],
        },
        provider: providerSchema,
      },
      required: ["kind"],
      additionalProperties: false,
    },
    schemaVersion: schemaVersionSchema,
    policyVersion: sha256Schema,
    payload: {
      type: "object",
    },
    previousHash: {
      anyOf: [sha256Schema, { type: "null" }],
    },
    eventHash: sha256Schema,
  },
  required: [
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
  ],
  allOf: [
    {
      if: {
        properties: { seq: { const: 1 } },
        required: ["seq"],
      },
      then: {
        properties: { previousHash: { type: "null" } },
      },
      else: {
        properties: { previousHash: sha256Schema },
      },
    },
    {
      if: {
        properties: {
          actor: {
            type: "object",
            properties: {
              kind: { enum: ["agent", "provider"] },
            },
            required: ["kind"],
          },
        },
      },
      then: {
        properties: {
          actor: {
            type: "object",
            properties: {
              kind: { type: "string" },
              provider: providerSchema,
            },
            required: ["kind", "provider"],
          },
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

export type EventEnvelope = FromSchema<typeof eventEnvelopeSchema>;
export type EventType = (typeof eventTypes)[number];
