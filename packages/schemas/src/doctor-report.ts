import type { FromSchema } from "json-schema-to-ts";

import { eventIdSchema, projectIdSchema } from "./common.js";

const doctorStatusSchema = {
  type: "string",
  enum: ["healthy", "unhealthy", "unknown"],
} as const;

export const doctorScopeSchema = {
  type: "string",
  enum: ["all", "knowledge", "documents", "skills", "providers", "search"],
} as const;

export const doctorCheckIdSchema = {
  type: "string",
  enum: [
    "event_chain",
    "document_registry",
    "document_sources",
    "skill_packages",
    "skill_lock",
    "provider_codex_runtime",
    "provider_claude_runtime",
    "search_engine_selection",
    "search_rollout_policies",
    "search_rollout_reviews",
    "search_rollout_actions",
  ],
} as const;

export const doctorIssueCodeSchema = {
  type: "string",
  enum: [
    "event_chain_invalid",
    "document_registry_invalid",
    "document_source_invalid",
    "skill_package_invalid",
    "skill_lock_missing",
    "skill_lock_invalid",
    "skill_lock_stale",
    "provider_executable_missing",
    "provider_probe_failed",
    "provider_platform_unsupported",
    "search_engine_selection_invalid",
    "search_rollout_policy_invalid",
    "search_rollout_review_invalid",
    "search_rollout_review_unavailable",
    "search_rollout_action_invalid",
    "search_rollout_action_unavailable",
  ],
} as const;

export const doctorRecoveryActionCodeSchema = {
  type: "string",
  enum: [
    "inspect_event_history",
    "inspect_document_registry",
    "inspect_document_source",
    "inspect_skill_package",
    "refresh_skill_lock",
    "check_provider_executable",
    "check_provider_platform",
    "inspect_search_selection",
    "inspect_search_policy",
    "inspect_search_review",
    "resolve_search_review_prerequisites",
    "inspect_search_action",
    "resolve_search_action_prerequisites",
  ],
} as const;

export const doctorReportSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/doctor-report.schema.json",
  title: "Lervo doctor report",
  type: "object",
  properties: {
    schemaVersion: { type: "integer", const: 2 },
    projectId: projectIdSchema,
    scope: doctorScopeSchema,
    status: doctorStatusSchema,
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          checkId: doctorCheckIdSchema,
          status: doctorStatusSchema,
          observedCount: { type: "integer", minimum: 0 },
          version: { type: "string", minLength: 1 },
        },
        required: ["checkId", "status", "observedCount"],
        additionalProperties: true,
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: doctorIssueCodeSchema,
          eventId: {
            anyOf: [eventIdSchema, { type: "null" }],
          },
          message: { type: "string", minLength: 1 },
        },
        required: ["code", "eventId", "message"],
        additionalProperties: true,
      },
    },
    recoveryGuidance: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issueCode: doctorIssueCodeSchema,
          actionCode: doctorRecoveryActionCodeSchema,
          message: { type: "string", minLength: 1 },
          actionState: { type: "string", const: "not_performed" },
        },
        required: ["issueCode", "actionCode", "message", "actionState"],
        additionalProperties: true,
      },
    },
  },
  required: [
    "schemaVersion",
    "projectId",
    "scope",
    "status",
    "checks",
    "issues",
    "recoveryGuidance",
  ],
  additionalProperties: true,
} as const;

export type DoctorReport = FromSchema<typeof doctorReportSchema>;
export type DoctorScope = DoctorReport["scope"];
export type DoctorCheck = DoctorReport["checks"][number];
export type DoctorIssue = DoctorReport["issues"][number];
export type DoctorIssueCode = DoctorIssue["code"];
export type DoctorRecoveryGuidance = DoctorReport["recoveryGuidance"][number];
export type DoctorRecoveryActionCode = DoctorRecoveryGuidance["actionCode"];
