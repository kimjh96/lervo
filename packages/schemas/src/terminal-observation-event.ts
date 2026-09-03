import type { FromSchema } from "json-schema-to-ts";

import { eventIdSchema, repositoryRelativePathSchema, sha256Schema } from "./common.js";

const observationIdSchema = {
  type: "string",
  pattern: "^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

const optionalTurnDigestSchema = { anyOf: [sha256Schema, { type: "null" }] } as const;
const optionalWorkspaceIdSchema = {
  anyOf: [{ type: "string", pattern: "^wsp_[a-f0-9]{24}$" }, { type: "null" }],
} as const;
const optionalAssignmentIdSchema = {
  anyOf: [{ type: "string", pattern: "^asn_[a-f0-9]{24}$" }, { type: "null" }],
} as const;
const optionalWriterSessionIdSchema = {
  anyOf: [{ type: "string", pattern: "^ses_[A-Za-z0-9_-]{8,128}$" }, { type: "null" }],
} as const;
const optionalPositiveIntegerSchema = {
  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
} as const;
const optionalExecutionKindSchema = {
  anyOf: [{ type: "string", enum: ["worker", "integrator"] }, { type: "null" }],
} as const;

const preparedDocumentSchema = {
  type: "object",
  properties: {
    conceptId: { type: "string", pattern: "^concept_[a-f0-9]{24}$" },
    path: repositoryRelativePathSchema,
    contentHash: sha256Schema,
    scope: { type: "string", enum: ["full", "prefix"] },
    deliveredByteCount: { type: "integer", minimum: 1, maximum: 131072 },
    assurance: { type: "string", enum: ["unreviewed", "human_reviewed"] },
    freshness: { type: "string", enum: ["current", "stale", "unknown"] },
  },
  required: [
    "conceptId",
    "path",
    "contentHash",
    "scope",
    "deliveredByteCount",
    "assurance",
    "freshness",
  ],
  additionalProperties: false,
} as const;

const queryProjectionReceiptSchema = {
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    receiptId: { type: "string", pattern: "^sqproj_[a-f0-9]{24}$" },
    stageId: { const: "query_projection" },
    projector: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$" },
        version: { type: "integer", minimum: 1, maximum: 1000000 },
        buildId: { type: "string", pattern: "^sqbuild_[a-f0-9]{24}$" },
      },
      required: ["id", "version", "buildId"],
      additionalProperties: false,
    },
    requestDigest: sha256Schema,
    contextDigest: sha256Schema,
    projectorResultDigest: sha256Schema,
    requestedLanguage: { type: "string", pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$" },
    limits: {
      type: "object",
      properties: {
        maximumQueries: { type: "integer", minimum: 1, maximum: 8 },
        maximumQueryCharacters: { type: "integer", minimum: 1, maximum: 500 },
      },
      required: ["maximumQueries", "maximumQueryCharacters"],
      additionalProperties: false,
    },
    projectedQueryCount: { type: "integer", minimum: 0, maximum: 8 },
    projectedQueryDigest: sha256Schema,
    durationMs: { type: "integer", minimum: 0, maximum: 600000 },
    status: { type: "string", enum: ["completed", "empty", "failed"] },
    usage: {
      type: "object",
      properties: {
        inputTokens: { type: "integer", minimum: 0 },
        cachedInputTokens: { type: "integer", minimum: 0 },
        outputTokens: { type: "integer", minimum: 0 },
        reasoningOutputTokens: { type: "integer", minimum: 0 },
        totalTokens: { type: "integer", minimum: 0 },
        contextWindow: {
          anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
        },
      },
      required: [
        "inputTokens",
        "cachedInputTokens",
        "outputTokens",
        "reasoningOutputTokens",
        "totalTokens",
        "contextWindow",
      ],
      additionalProperties: false,
    },
    privacy: {
      type: "object",
      properties: {
        requestText: { const: "excluded" },
        contextText: { const: "excluded" },
        projectedQueryText: { const: "excluded" },
      },
      required: ["requestText", "contextText", "projectedQueryText"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "receiptId",
    "stageId",
    "projector",
    "requestDigest",
    "contextDigest",
    "projectorResultDigest",
    "requestedLanguage",
    "limits",
    "projectedQueryCount",
    "projectedQueryDigest",
    "durationMs",
    "status",
    "privacy",
  ],
  additionalProperties: false,
} as const;

export const terminalContextPreparedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-context-prepared-event-payload.schema.json",
  type: "object",
  properties: {
    observationId: observationIdSchema,
    executionMode: { const: "unmanaged" },
    providerSessionDigest: sha256Schema,
    providerTurnDigest: optionalTurnDigestSchema,
    sourceSnapshotId: { type: "string", pattern: "^ksnap_[a-f0-9]{24}$" },
    repositoryRevision: sha256Schema,
    requestDigest: sha256Schema,
    queryDigest: sha256Schema,
    queryProjectionReceipt: queryProjectionReceiptSchema,
    groundingStatus: {
      type: "string",
      enum: ["ready", "clarify", "abstain", "approval_required"],
    },
    groundingWorkflowId: {
      anyOf: [
        { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$" },
        { type: "null" },
      ],
    },
    groundingSourceClasses: {
      type: "array",
      maxItems: 7,
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "user_context",
          "repository_instructions",
          "current_workstream",
          "durable_decision",
          "repository_state",
          "knowledge_projection",
          "execution_evidence",
        ],
      },
    },
    groundingSubjectIds: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$" },
    },
    groundingProviderIds: {
      type: "array",
      maxItems: 8,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9._-]{0,63}$" },
    },
    groundingReasons: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$" },
    },
    durableInstructionStatus: {
      type: "string",
      enum: ["ignored", "workstream", "current", "pending", "applied", "blocked"],
    },
    durableInstructionRuleId: {
      anyOf: [{ type: "string", pattern: "^rule_[a-f0-9]{24}$" }, { type: "null" }],
    },
    durableInstructionTargetPath: {
      anyOf: [repositoryRelativePathSchema, { type: "null" }],
    },
    durableInstructionReasonIds: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$" },
    },
    selectionStatus: { type: "string", enum: ["selected", "not_selected"] },
    loadingStatus: { type: "string", enum: ["observed", "not_run"] },
    hookPreparationStatus: { const: "observed" },
    providerInjectionStatus: { const: "unobserved" },
    providerUseStatus: { const: "unknown" },
    contextHash: sha256Schema,
    recommendationCount: { type: "integer", minimum: 0, maximum: 100 },
    loadedDocuments: { type: "array", items: preparedDocumentSchema, maxItems: 6 },
    workstreamId: { anyOf: [{ type: "string", pattern: "^wks_[a-f0-9]{24}$" }, { type: "null" }] },
    workstreamRevision: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    workstreamSnapshotHash: { anyOf: [sha256Schema, { type: "null" }] },
    workstreamScope: { anyOf: [{ type: "string", enum: ["full", "prefix"] }, { type: "null" }] },
    workstreamDeliveredByteCount: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 8192 }, { type: "null" }],
    },
    workspaceExecutionKind: optionalExecutionKindSchema,
    workspaceId: optionalWorkspaceIdSchema,
    workspaceGeneration: optionalPositiveIntegerSchema,
    workspaceRevision: optionalPositiveIntegerSchema,
    assignmentId: optionalAssignmentIdSchema,
    leaseGeneration: optionalPositiveIntegerSchema,
    writerSessionId: optionalWriterSessionIdSchema,
  },
  required: [
    "observationId",
    "executionMode",
    "providerSessionDigest",
    "providerTurnDigest",
    "sourceSnapshotId",
    "queryDigest",
    "contextHash",
    "recommendationCount",
    "loadedDocuments",
  ],
  dependentRequired: {
    requestDigest: [
      "groundingStatus",
      "groundingWorkflowId",
      "groundingSourceClasses",
      "groundingSubjectIds",
      "groundingProviderIds",
      "groundingReasons",
      "selectionStatus",
      "loadingStatus",
      "hookPreparationStatus",
      "providerInjectionStatus",
      "providerUseStatus",
    ],
    queryProjectionReceipt: [
      "requestDigest",
      "groundingStatus",
      "groundingWorkflowId",
      "groundingSourceClasses",
      "groundingSubjectIds",
      "groundingProviderIds",
      "groundingReasons",
      "selectionStatus",
      "loadingStatus",
      "hookPreparationStatus",
      "providerInjectionStatus",
      "providerUseStatus",
    ],
    repositoryRevision: [
      "workstreamId",
      "workstreamRevision",
      "workstreamSnapshotHash",
      "workstreamScope",
      "workstreamDeliveredByteCount",
    ],
    workstreamId: [
      "workstreamRevision",
      "workstreamSnapshotHash",
      "workstreamScope",
      "workstreamDeliveredByteCount",
    ],
    workstreamRevision: [
      "workstreamId",
      "workstreamSnapshotHash",
      "workstreamScope",
      "workstreamDeliveredByteCount",
    ],
    workstreamSnapshotHash: [
      "workstreamId",
      "workstreamRevision",
      "workstreamScope",
      "workstreamDeliveredByteCount",
    ],
    workstreamScope: [
      "workstreamId",
      "workstreamRevision",
      "workstreamSnapshotHash",
      "workstreamDeliveredByteCount",
    ],
    workstreamDeliveredByteCount: [
      "workstreamId",
      "workstreamRevision",
      "workstreamSnapshotHash",
      "workstreamScope",
    ],
    durableInstructionStatus: [
      "durableInstructionRuleId",
      "durableInstructionTargetPath",
      "durableInstructionReasonIds",
    ],
    durableInstructionRuleId: [
      "durableInstructionStatus",
      "durableInstructionTargetPath",
      "durableInstructionReasonIds",
    ],
    durableInstructionTargetPath: [
      "durableInstructionStatus",
      "durableInstructionRuleId",
      "durableInstructionReasonIds",
    ],
    durableInstructionReasonIds: [
      "durableInstructionStatus",
      "durableInstructionRuleId",
      "durableInstructionTargetPath",
    ],
  },
  additionalProperties: false,
} as const;

export const terminalReferenceObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-reference-observed-event-payload.schema.json",
  type: "object",
  properties: {
    observationId: observationIdSchema,
    contextEventId: eventIdSchema,
    conceptId: { type: "string", pattern: "^concept_[a-f0-9]{24}$" },
    path: repositoryRelativePathSchema,
    contentHash: sha256Schema,
    scope: { type: "string", enum: ["full", "prefix"] },
    referenceKind: { const: "output_citation" },
    providerSessionDigest: sha256Schema,
    providerTurnDigest: optionalTurnDigestSchema,
  },
  required: [
    "observationId",
    "contextEventId",
    "conceptId",
    "path",
    "contentHash",
    "scope",
    "referenceKind",
    "providerSessionDigest",
    "providerTurnDigest",
  ],
  additionalProperties: false,
} as const;

export const terminalTurnObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-turn-observed-event-payload.schema.json",
  type: "object",
  properties: {
    observationId: observationIdSchema,
    contextEventId: eventIdSchema,
    referenceEventIds: { type: "array", items: eventIdSchema, maxItems: 6, uniqueItems: true },
    referenceCount: { type: "integer", minimum: 0, maximum: 6 },
    referenceTelemetry: { type: "string", enum: ["observed", "unavailable"] },
    lifecycleStatus: { type: "string", enum: ["current", "action_required"] },
    completionResult: { type: "string", enum: ["allowed", "blocked"] },
    repositoryRevisionBefore: sha256Schema,
    repositoryRevisionAfter: sha256Schema,
    repositoryChanged: { type: "boolean" },
    finalWorkstreamId: {
      anyOf: [{ type: "string", pattern: "^wks_[a-f0-9]{24}$" }, { type: "null" }],
    },
    finalWorkstreamRevision: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    finalWorkstreamSnapshotHash: { anyOf: [sha256Schema, { type: "null" }] },
    providerSessionDigest: sha256Schema,
    providerTurnDigest: optionalTurnDigestSchema,
    workspaceExecutionKind: optionalExecutionKindSchema,
    workspaceId: optionalWorkspaceIdSchema,
    workspaceGeneration: optionalPositiveIntegerSchema,
    workspaceRevision: optionalPositiveIntegerSchema,
    assignmentId: optionalAssignmentIdSchema,
    leaseGeneration: optionalPositiveIntegerSchema,
    writerSessionId: optionalWriterSessionIdSchema,
    workspaceCheckpointEventId: { anyOf: [eventIdSchema, { type: "null" }] },
  },
  required: [
    "observationId",
    "contextEventId",
    "referenceEventIds",
    "referenceCount",
    "referenceTelemetry",
    "lifecycleStatus",
    "completionResult",
    "providerSessionDigest",
    "providerTurnDigest",
  ],
  dependentRequired: {
    repositoryRevisionBefore: [
      "repositoryRevisionAfter",
      "repositoryChanged",
      "finalWorkstreamId",
      "finalWorkstreamRevision",
      "finalWorkstreamSnapshotHash",
    ],
    repositoryRevisionAfter: [
      "repositoryRevisionBefore",
      "repositoryChanged",
      "finalWorkstreamId",
      "finalWorkstreamRevision",
      "finalWorkstreamSnapshotHash",
    ],
    repositoryChanged: [
      "repositoryRevisionBefore",
      "repositoryRevisionAfter",
      "finalWorkstreamId",
      "finalWorkstreamRevision",
      "finalWorkstreamSnapshotHash",
    ],
    finalWorkstreamId: [
      "repositoryRevisionBefore",
      "repositoryRevisionAfter",
      "repositoryChanged",
      "finalWorkstreamRevision",
      "finalWorkstreamSnapshotHash",
    ],
    finalWorkstreamRevision: [
      "repositoryRevisionBefore",
      "repositoryRevisionAfter",
      "repositoryChanged",
      "finalWorkstreamId",
      "finalWorkstreamSnapshotHash",
    ],
    finalWorkstreamSnapshotHash: [
      "repositoryRevisionBefore",
      "repositoryRevisionAfter",
      "repositoryChanged",
      "finalWorkstreamId",
      "finalWorkstreamRevision",
    ],
  },
  additionalProperties: false,
} as const;

export type TerminalContextPreparedEventPayload = FromSchema<
  typeof terminalContextPreparedEventPayloadSchema
>;
export type TerminalReferenceObservedEventPayload = FromSchema<
  typeof terminalReferenceObservedEventPayloadSchema
>;
export type TerminalTurnObservedEventPayload = FromSchema<
  typeof terminalTurnObservedEventPayloadSchema
>;
