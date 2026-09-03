import type { FromSchema } from "json-schema-to-ts";

import { eventIdSchema, projectIdSchema, providerSchema, sha256Schema } from "./common.js";
import { repositoryPerformanceProfileSchema } from "./execution-environment-profile.js";

const reasonCodeSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,63}$",
} as const;

const dispositionSchema = {
  type: "string",
  enum: ["passed", "blocked", "escalation_required"],
} as const;

export const terminalBudgetPolicySchema = {
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    promptP95BudgetMs: { type: "number", const: 15000 },
    stopP95BudgetMs: { type: "number", const: 5000 },
    maximumHookDurationMs: { type: "number", const: 30000 },
    minimumSamples: { type: "integer", minimum: 1, maximum: 100 },
    maxQueryProjectionTokens: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 9007199254740991 }, { type: "null" }],
    },
    unobservedAction: { type: "string", enum: ["block", "escalate"] },
    exhaustedAction: { type: "string", enum: ["block", "escalate"] },
  },
  required: [
    "schemaVersion",
    "promptP95BudgetMs",
    "stopP95BudgetMs",
    "maximumHookDurationMs",
    "minimumSamples",
    "maxQueryProjectionTokens",
    "unobservedAction",
    "exhaustedAction",
  ],
  additionalProperties: false,
} as const;

const hookProfileSchema = {
  type: "object",
  properties: {
    provider: providerSchema,
    hookEvent: { type: "string", enum: ["UserPromptSubmit", "Stop"] },
    environmentProfileDigest: sha256Schema,
    repositoryProfile: repositoryPerformanceProfileSchema,
    coldState: { type: "string", enum: ["cold", "warm", "unknown"] },
    sampleCount: { type: "integer", minimum: 1, maximum: 100 },
    p95DurationMs: { type: "number", minimum: 0 },
    maximumDurationMs: { type: "number", minimum: 0 },
    budgetMs: { type: "number", minimum: 0 },
    status: { type: "string", enum: ["below", "exhausted", "unobservable"] },
    reasonCodes: { type: "array", items: reasonCodeSchema, uniqueItems: true },
  },
  required: [
    "provider",
    "hookEvent",
    "environmentProfileDigest",
    "repositoryProfile",
    "coldState",
    "sampleCount",
    "p95DurationMs",
    "maximumDurationMs",
    "budgetMs",
    "status",
    "reasonCodes",
  ],
  additionalProperties: false,
} as const;

const queryAssessmentSchema = {
  type: "object",
  properties: {
    provider: providerSchema,
    contextEventId: eventIdSchema,
    observedTokens: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    limitTokens: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    status: {
      type: "string",
      enum: ["below", "exhausted", "unobservable", "not_configured"],
    },
    reasonCode: { anyOf: [reasonCodeSchema, { type: "null" }] },
  },
  required: ["provider", "contextEventId", "observedTokens", "limitTokens", "status", "reasonCode"],
  additionalProperties: false,
} as const;

export const terminalBudgetReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-budget-report.schema.json",
  title: "Lervo unmanaged terminal budget assessment",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    reportKind: { const: "unmanaged_terminal_budget" },
    projectId: projectIdSchema,
    policy: terminalBudgetPolicySchema,
    sourceReportCount: { type: "integer", minimum: 0, maximum: 100 },
    missingHookObservationCount: { type: "integer", minimum: 0, maximum: 200 },
    incompleteHookOutcomeCount: { type: "integer", minimum: 0, maximum: 200 },
    invalidStageObservationSetCount: { type: "integer", minimum: 0, maximum: 100 },
    hookProfiles: { type: "array", items: hookProfileSchema, maxItems: 200 },
    queryProjections: { type: "array", items: queryAssessmentSchema, maxItems: 100 },
    wholeTaskUsage: {
      type: "object",
      properties: {
        status: { const: "unsupported" },
        reasonCode: { const: "unmanaged_provider_usage_unobserved" },
      },
      required: ["status", "reasonCode"],
      additionalProperties: false,
    },
    disposition: dispositionSchema,
    reasonCodes: { type: "array", items: reasonCodeSchema, uniqueItems: true },
  },
  required: [
    "schemaVersion",
    "reportKind",
    "projectId",
    "policy",
    "sourceReportCount",
    "missingHookObservationCount",
    "incompleteHookOutcomeCount",
    "invalidStageObservationSetCount",
    "hookProfiles",
    "queryProjections",
    "wholeTaskUsage",
    "disposition",
    "reasonCodes",
  ],
  additionalProperties: false,
} as const;

export type TerminalBudgetPolicy = FromSchema<typeof terminalBudgetPolicySchema>;
export type TerminalBudgetReport = FromSchema<typeof terminalBudgetReportSchema>;
