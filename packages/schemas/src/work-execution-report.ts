import type { FromSchema } from "json-schema-to-ts";

import { projectIdSchema, runIdSchema, sessionIdSchema, sha256Schema } from "./common.js";
import { workIdSchema } from "./execution-observability-event.js";
import { resourceUsageSchema } from "./resource-usage-event.js";
import { executionStageObservationSchema } from "./execution-observability-event.js";
import { repositoryPerformanceProfileSchema } from "./execution-environment-profile.js";
import { resourceAccountingModeSchema } from "./resource-accounting.js";

const reasonCodeSchema = { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" } as const;
const completenessSchema = {
  type: "string",
  enum: ["complete", "partial", "unavailable", "invalid"],
} as const;

export const workExecutionReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/work-execution-report.schema.json",
  type: "object",
  properties: {
    reportKind: { const: "managed_work_execution" },
    schemaVersion: { type: "integer", const: 1 },
    projectId: projectIdSchema,
    workId: workIdSchema,
    completeness: completenessSchema,
    missingReasons: { type: "array", items: reasonCodeSchema, uniqueItems: true },
    runs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          runId: runIdSchema,
          sessionIds: { type: "array", items: sessionIdSchema, uniqueItems: true },
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
          parentRunId: { anyOf: [runIdSchema, { type: "null" }] },
          retryOfRunId: { anyOf: [runIdSchema, { type: "null" }] },
          attemptOrdinal: { type: "integer", minimum: 1 },
          provider: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
          status: { type: "string", enum: ["completed", "failed", "incomplete"] },
          firstOccurredAt: { type: "string", format: "date-time" },
          lastOccurredAt: { type: "string", format: "date-time" },
        },
        required: [
          "runId",
          "sessionIds",
          "relationship",
          "parentRunId",
          "retryOfRunId",
          "attemptOrdinal",
          "provider",
          "status",
          "firstOccurredAt",
          "lastOccurredAt",
        ],
        additionalProperties: false,
      },
    },
    resources: {
      type: "object",
      properties: {
        completeness: completenessSchema,
        missingReasons: { type: "array", items: reasonCodeSchema, uniqueItems: true },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              provider: { type: "string", minLength: 1 },
              scope: {
                type: "string",
                enum: [
                  "primary_provider",
                  "subagent_provider",
                  "query_projection",
                  "publication_evaluation",
                  "deliberation",
                  "improvement_evaluation",
                ],
              },
              source: {
                type: "string",
                enum: ["provider_reported", "lervo_measured", "estimated"],
              },
              accountingMode: resourceAccountingModeSchema,
              accountingDescriptorHash: sha256Schema,
              completeness: completenessSchema,
              missingReasons: { type: "array", items: reasonCodeSchema, uniqueItems: true },
              observations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    runId: runIdSchema,
                    resourceObservationId: { type: "string", pattern: "^ruo_[a-f0-9]{24}$" },
                    sourceCoordinateDigest: sha256Schema,
                    status: {
                      type: "string",
                      enum: ["observed", "partial", "unavailable", "invalid"],
                    },
                    usage: { anyOf: [resourceUsageSchema, { type: "null" }] },
                    reasonCode: { anyOf: [reasonCodeSchema, { type: "null" }] },
                  },
                  required: [
                    "runId",
                    "resourceObservationId",
                    "sourceCoordinateDigest",
                    "status",
                    "usage",
                    "reasonCode",
                  ],
                  additionalProperties: false,
                },
              },
              totalUsage: { anyOf: [resourceUsageSchema, { type: "null" }] },
            },
            required: [
              "provider",
              "scope",
              "source",
              "accountingMode",
              "accountingDescriptorHash",
              "completeness",
              "missingReasons",
              "observations",
              "totalUsage",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["completeness", "missingReasons", "groups"],
      additionalProperties: false,
    },
    stages: {
      type: "object",
      properties: {
        completeness: completenessSchema,
        missingReasons: { type: "array", items: reasonCodeSchema, uniqueItems: true },
        observationSetCount: { type: "integer", minimum: 0 },
        observations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              runId: runIdSchema,
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
              "runId",
              "observationSetId",
              "environmentProfileDigest",
              "repositoryProfile",
              "stages",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["completeness", "missingReasons", "observationSetCount", "observations"],
      additionalProperties: false,
    },
    cost: {
      type: "object",
      properties: { status: { const: "not_in_foundation_scope" } },
      required: ["status"],
      additionalProperties: false,
    },
  },
  required: [
    "reportKind",
    "schemaVersion",
    "projectId",
    "workId",
    "completeness",
    "missingReasons",
    "runs",
    "resources",
    "stages",
    "cost",
  ],
  additionalProperties: false,
} as const;

export type WorkExecutionReport = FromSchema<typeof workExecutionReportSchema>;
