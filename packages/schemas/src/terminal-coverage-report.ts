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
      items: { type: "string", enum: ["output_citation"] },
      maxItems: 1,
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
        result: { type: "string", enum: ["allowed", "blocked", "not_observed"] },
        lifecycleStatus: { type: "string", enum: ["current", "action_required", "not_observed"] },
      },
      required: ["result", "lifecycleStatus"],
      additionalProperties: false,
    },
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
