import type { FromSchema } from "json-schema-to-ts";

import {
  eventIdSchema,
  projectIdSchema,
  providerSchema,
  repositoryRelativePathSchema,
  runIdSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { executionStageObservationSchema } from "./execution-observability-event.js";
import { resourceUsageSchema } from "./resource-usage-event.js";
import { repositoryPerformanceProfileSchema } from "./execution-environment-profile.js";

const resourceObservationSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["partial", "unavailable"] },
    usage: { anyOf: [resourceUsageSchema, { type: "null" }] },
    reasonCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
  },
  required: ["status", "usage", "reasonCode"],
  oneOf: [
    {
      properties: { status: { const: "partial" }, usage: resourceUsageSchema },
      required: ["status", "usage"],
    },
    {
      properties: { status: { const: "unavailable" }, usage: { type: "null" } },
      required: ["status", "usage"],
    },
  ],
  additionalProperties: false,
} as const;

const ratioSchema = {
  type: "object",
  properties: {
    numerator: { type: "integer", minimum: 0 },
    denominator: { type: "integer", minimum: 0 },
    value: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
    reason: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
  },
  required: ["numerator", "denominator", "value", "reason"],
  additionalProperties: false,
} as const;

const terminalDocumentObservationSchema = {
  type: "object",
  properties: {
    conceptId: { type: "string", pattern: "^concept_[a-f0-9]{24}$" },
    path: repositoryRelativePathSchema,
    contentHash: sha256Schema,
    scope: { type: "string", enum: ["full", "prefix"] },
    deliveredByteCount: { type: "integer", minimum: 1, maximum: 131072 },
    assurance: { type: "string", enum: ["unreviewed", "human_reviewed"] },
    freshness: { type: "string", enum: ["current", "stale", "unknown"] },
    highestObservation: { type: "string", enum: ["prepared", "referenced"] },
    referenceKinds: {
      type: "array",
      items: { type: "string", enum: ["output_citation", "path_mention"] },
      maxItems: 2,
      uniqueItems: true,
    },
  },
  required: [
    "conceptId",
    "path",
    "contentHash",
    "scope",
    "deliveredByteCount",
    "assurance",
    "freshness",
    "highestObservation",
    "referenceKinds",
  ],
  additionalProperties: false,
} as const;

const terminalStageCoverageSchema = {
  type: "object",
  properties: {
    completeness: { type: "string", enum: ["complete", "partial", "unavailable", "invalid"] },
    missingReasons: {
      type: "array",
      items: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
      uniqueItems: true,
    },
    observations: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          hookEvent: { type: "string", enum: ["UserPromptSubmit", "Stop"] },
          observationSetId: { type: "string", pattern: "^stgobs_[a-f0-9]{24}$" },
          environmentProfileDigest: sha256Schema,
          repositoryProfile: repositoryPerformanceProfileSchema,
          stages: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            items: executionStageObservationSchema,
          },
        },
        required: [
          "hookEvent",
          "observationSetId",
          "environmentProfileDigest",
          "repositoryProfile",
          "stages",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["completeness", "missingReasons", "observations"],
  additionalProperties: false,
} as const;

const terminalTurnCoverageSchema = {
  type: "object",
  properties: {
    executionMode: { const: "unmanaged" },
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    provider: providerSchema,
    contextEventId: eventIdSchema,
    occurredAt: timestampSchema,
    completedAt: { anyOf: [timestampSchema, { type: "null" }] },
    sourceSnapshotId: { type: "string", pattern: "^ksnap_[a-f0-9]{24}$" },
    queryDigest: sha256Schema,
    contextHash: sha256Schema,
    selectedCount: { type: ["integer", "null"], minimum: 0 },
    referenceCount: { type: ["integer", "null"], minimum: 0 },
    pathMentionCount: { type: ["integer", "null"], minimum: 0 },
    capabilities: {
      type: "object",
      properties: {
        hookContextPreparation: { const: "observed" },
        providerContextAcceptance: { const: "unsupported" },
        explicitOutputReference: {
          type: "string",
          enum: ["observed", "supported_no_observation", "unavailable"],
        },
        internalUse: { const: "unsupported" },
      },
      required: [
        "hookContextPreparation",
        "providerContextAcceptance",
        "explicitOutputReference",
        "internalUse",
      ],
      additionalProperties: false,
    },
    documents: { type: "array", items: terminalDocumentObservationSchema, maxItems: 6 },
    coverage: {
      type: "object",
      properties: {
        candidatePreparation: ratioSchema,
        managedDelivery: ratioSchema,
        explicitReference: ratioSchema,
        relevance: ratioSchema,
      },
      required: ["candidatePreparation", "managedDelivery", "explicitReference", "relevance"],
      additionalProperties: false,
    },
    completion: {
      type: "object",
      properties: {
        result: { type: "string", enum: ["allowed", "blocked", "not_checked", "not_observed"] },
        lifecycleStatus: { type: "string", enum: ["current", "action_required", "not_observed"] },
      },
      required: ["result", "lifecycleStatus"],
      additionalProperties: false,
    },
    resources: {
      type: "object",
      properties: {
        wholeTask: resourceObservationSchema,
        queryProjection: resourceObservationSchema,
      },
      required: ["wholeTask", "queryProjection"],
      additionalProperties: false,
    },
    stages: terminalStageCoverageSchema,
  },
  required: [
    "executionMode",
    "runId",
    "sessionId",
    "provider",
    "contextEventId",
    "occurredAt",
    "completedAt",
    "sourceSnapshotId",
    "queryDigest",
    "contextHash",
    "capabilities",
    "documents",
    "coverage",
    "completion",
    "resources",
    "stages",
  ],
  additionalProperties: false,
} as const;

export const terminalCoverageReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-coverage-report.schema.json",
  title: "Lervo unmanaged terminal context coverage report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    reportKind: { const: "unmanaged_terminal_context" },
    projectId: projectIdSchema,
    reports: { type: "array", items: terminalTurnCoverageSchema, maxItems: 100 },
  },
  required: ["schemaVersion", "reportKind", "projectId", "reports"],
  additionalProperties: false,
} as const;

export type TerminalCoverageReport = FromSchema<typeof terminalCoverageReportSchema>;
export type TerminalTurnCoverage = TerminalCoverageReport["reports"][number];
