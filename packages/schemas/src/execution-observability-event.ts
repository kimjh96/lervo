import type { FromSchema } from "json-schema-to-ts";

import { runIdSchema, sha256Schema } from "./common.js";

export const workIdSchema = {
  type: "string",
  pattern: "^wrk_[a-f0-9]{24}$",
} as const;

const nullableRunIdSchema = { anyOf: [runIdSchema, { type: "null" }] } as const;
const nullableWorkstreamIdSchema = {
  anyOf: [{ type: "string", pattern: "^wks_[a-f0-9]{24}$" }, { type: "null" }],
} as const;
const nullableAssignmentIdSchema = {
  anyOf: [{ type: "string", pattern: "^asn_[a-f0-9]{24}$" }, { type: "null" }],
} as const;
const nullableAgentIdSchema = {
  anyOf: [{ type: "string", pattern: "^agt_[a-f0-9]{24}$" }, { type: "null" }],
} as const;

const workCausalityProperties = {
  workId: workIdSchema,
  executionContractVersion: { type: "integer", const: 1 },
  relationship: {
    type: "string",
    enum: [
      "root",
      "retry",
      "repair",
      "subagent",
      "verification",
      "publication_evaluation",
      "deliberation",
      "improvement_evaluation",
    ],
  },
  parentRunId: nullableRunIdSchema,
  retryOfRunId: nullableRunIdSchema,
  attemptOrdinal: { type: "integer", minimum: 1 },
  workstreamId: nullableWorkstreamIdSchema,
  assignmentId: nullableAssignmentIdSchema,
  agentId: nullableAgentIdSchema,
} as const;

export const workCausalityRecordedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/work-causality-recorded-event-payload.schema.json",
  type: "object",
  properties: workCausalityProperties,
  required: [
    "workId",
    "executionContractVersion",
    "relationship",
    "parentRunId",
    "retryOfRunId",
    "attemptOrdinal",
    "workstreamId",
    "assignmentId",
    "agentId",
  ],
  oneOf: [
    {
      properties: {
        relationship: { const: "root" },
        parentRunId: { type: "null" },
        retryOfRunId: { type: "null" },
        attemptOrdinal: { const: 1 },
      },
      required: ["relationship", "parentRunId", "retryOfRunId", "attemptOrdinal"],
    },
    {
      properties: {
        relationship: { const: "retry" },
        parentRunId: runIdSchema,
        retryOfRunId: runIdSchema,
        attemptOrdinal: { type: "integer", minimum: 2 },
      },
      required: ["relationship", "parentRunId", "retryOfRunId", "attemptOrdinal"],
    },
    {
      properties: {
        relationship: {
          enum: [
            "repair",
            "subagent",
            "verification",
            "publication_evaluation",
            "deliberation",
            "improvement_evaluation",
          ],
        },
        parentRunId: runIdSchema,
        retryOfRunId: { type: "null" },
      },
      required: ["relationship", "parentRunId", "retryOfRunId"],
    },
  ],
  additionalProperties: false,
} as const;

export const executionStageIdsV1 = [
  "ingress_integrity",
  "repository_discovery",
  "projection_admission",
  "corpus_preparation",
  "search",
  "selection",
  "exact_loading",
  "context_assembly",
  "event_commit",
  "provider_start",
  "context_injection",
  "provider_turn",
  "provider_stop",
  "repository_snapshot",
  "verification",
  "lifecycle_inspection",
  "total",
] as const;

export const executionStageIds = [...executionStageIdsV1, "query_projection"] as const;

export const executionStageIdSchema = { type: "string", enum: executionStageIds } as const;

export const executionStageObservationSchema = {
  type: "object",
  properties: {
    stageId: executionStageIdSchema,
    parentStageId: { anyOf: [executionStageIdSchema, { type: "null" }] },
    durationMs: { type: "number", minimum: 0 },
    budgetMs: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
    outcome: {
      type: "string",
      enum: ["completed", "failed", "cancelled", "timeout", "abstained"],
    },
    coldState: { type: "string", enum: ["cold", "warm", "unknown"] },
  },
  required: ["stageId", "parentStageId", "durationMs", "budgetMs", "outcome", "coldState"],
  additionalProperties: false,
} as const;

export const terminalHookFailureReasons = [
  "repository_snapshot_limit_exceeded",
  "repository_snapshot_deadline_exceeded",
  "repository_snapshot_failed",
  "git_ignored_paths_unavailable",
  "knowledge_inspection_failed",
  "hook_deadline_exceeded",
  "repository_discovery_failed",
  "lifecycle_inspection_failed",
  "event_persistence_failed",
  "hook_input_invalid",
  "unexpected_error",
] as const;
export type TerminalHookFailureReason = (typeof terminalHookFailureReasons)[number];

const executionStagesObservedProperties = {
  executionMode: { type: "string", enum: ["managed", "unmanaged_terminal"] },
  workId: { anyOf: [workIdSchema, { type: "null" }] },
  terminalObservationId: {
    anyOf: [{ type: "string", pattern: "^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$" }, { type: "null" }],
  },
  failureReason: { type: "string", enum: terminalHookFailureReasons },
  terminalHook: {
    anyOf: [{ type: "string", enum: ["UserPromptSubmit", "Stop"] }, { type: "null" }],
  },
  observationSetId: { type: "string", pattern: "^stgobs_[a-f0-9]{24}$" },
  stageCatalogVersion: { type: "integer", enum: [1, 2] },
  environmentProfileDigest: sha256Schema,
  repositoryProfile: { type: "string", enum: ["small", "medium", "large", "custom"] },
  stages: {
    type: "array",
    minItems: 1,
    maxItems: 32,
    items: executionStageObservationSchema,
  },
} as const;

export const executionStagesObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/execution-stages-observed-event-payload.schema.json",
  type: "object",
  properties: executionStagesObservedProperties,
  required: [
    "executionMode",
    "workId",
    "terminalObservationId",
    "observationSetId",
    "stageCatalogVersion",
    "environmentProfileDigest",
    "repositoryProfile",
    "stages",
  ],
  oneOf: [
    {
      properties: {
        executionMode: { const: "managed" },
        workId: workIdSchema,
        terminalObservationId: { type: "null" },
        terminalHook: { type: "null" },
      },
      required: ["executionMode", "workId", "terminalObservationId"],
    },
    {
      properties: {
        executionMode: { const: "unmanaged_terminal" },
        workId: { type: "null" },
        terminalObservationId: {
          type: "string",
          pattern: "^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
        },
        terminalHook: { type: "string", enum: ["UserPromptSubmit", "Stop"] },
      },
      required: ["executionMode", "workId", "terminalObservationId"],
    },
  ],
  additionalProperties: false,
} as const;

export type WorkCausalityRecordedEventPayload = FromSchema<
  typeof workCausalityRecordedEventPayloadSchema
>;
export type ExecutionStagesObservedEventPayload = FromSchema<
  typeof executionStagesObservedEventPayloadSchema
>;
